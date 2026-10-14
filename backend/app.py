import os
import json
import base64
import logging
import tempfile
from threading import RLock

import requests
import assemblyai as aai
from flask import Flask, request, Response, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langgraph.checkpoint.memory import InMemorySaver
from langchain.agents import create_agent


# Load environment variables from the backend directory / current working directory.
load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
MURF_API_KEY = os.getenv("MURF_API_KEY")
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")

MURF_URL = "https://global.api.murf.ai/v1/speech/stream"
MODEL_NAME = os.getenv("GEMINI_MODEL", "google_genai:gemini-3.5-flash-lite")
MURF_VOICE_ID = os.getenv("MURF_VOICE_ID", "en-US-natalie")

app = Flask(__name__)
CORS(app, expose_headers=["X-Question-Number", "X-Interview-Complete"])
logging.basicConfig(level=logging.INFO)
app.logger.setLevel(logging.INFO)

# Validate configuration at startup so missing keys are easy to diagnose.
if not GOOGLE_API_KEY:
    raise RuntimeError("GOOGLE_API_KEY is missing from your .env file")
if not MURF_API_KEY:
    raise RuntimeError("MURF_API_KEY is missing from your .env file")
if not ASSEMBLYAI_API_KEY:
    raise RuntimeError("ASSEMBLYAI_API_KEY is missing from your .env file")

aai.settings.api_key = ASSEMBLYAI_API_KEY

# If Google rejects this model name for your account, set GEMINI_MODEL in .env
# to a model ID currently enabled for your Gemini API key.
model = init_chat_model(MODEL_NAME, api_key=GOOGLE_API_KEY)

INTERVIEW_PROMPT = """
You are Natalie, a friendly and conversational interviewer conducting a
natural {subject} interview.

Guidelines:
1. Conduct exactly five interview questions total.
2. Keep each question short and crisp (1-2 sentences maximum).
3. Refer only to things the candidate actually said.
4. Do not invent or assume candidate answers.
5. Give brief, genuine acknowledgments based on their responses.
6. Adapt questions to the candidate's actual responses.
7. Be warm, conversational, and concise.
8. Ask one question at a time.
"""

FEEDBACK_PROMPT_TEMPLATE = """
Review the interview conversation for the subject: {subject}.

Return ONLY one valid JSON object, with no markdown or text outside it, using
this exact structure:
{{
  "subject": "{subject}",
  "candidate_score": 3,
  "feedback": "Detailed strengths with specific examples from the candidate's actual answers.",
  "areas_of_improvement": "Constructive suggestions based on gaps in the actual answers."
}}

Rules:
- candidate_score must be an integer from 1 to 5.
- Address the candidate directly as "you" and "your".
- Reference only answers actually present in the conversation.
- Do not invent examples or answers.
"""

# This in-memory state is appropriate only for a local, single-user prototype.
# Use a persistent database and per-user session IDs before deploying publicly.
state_lock = RLock()
checkpointer = InMemorySaver()
agent = None
question_count = 0
current_subject = ""
thread_id = "interview_session"


def create_interview_agent():
    """Create an agent with fresh in-memory conversation history."""
    global checkpointer
    checkpointer = InMemorySaver()
    return create_agent(model=model, tools=[], checkpointer=checkpointer)


def get_message_text(message):
    """Extract readable text from a LangChain message."""
    content = getattr(message, "content", None)
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        pieces = []
        for part in content:
            if isinstance(part, dict):
                value = part.get("text")
                if value:
                    pieces.append(str(value))
        return " ".join(pieces).strip()
    # Compatibility fallback for message-like objects.
    value = getattr(message, "text", "")
    return value.strip() if isinstance(value, str) else ""


def latest_message_text(result):
    messages = result.get("messages", [])
    if not messages:
        raise RuntimeError("The model returned no messages.")
    text = get_message_text(messages[-1])
    if not text:
        raise RuntimeError("The model returned an empty response.")
    return text


def speech_to_text(audio_path):
    """Transcribe a recorded answer with AssemblyAI."""
    transcriber = aai.Transcriber()
    config = aai.TranscriptionConfig(
        speech_models=["universal-3-pro", "universal-2"],
        language_detection=True,
    )
    transcript = transcriber.transcribe(audio_path, config=config)
    if getattr(transcript, "status", None) == aai.TranscriptStatus.error:
        raise RuntimeError(getattr(transcript, "error", "Audio transcription failed"))
    return transcript.text.strip() if transcript.text else ""


def request_murf_audio(text):
    """Request Murf audio and validate its HTTP status before responding."""
    payload = {
        "text": text,
        "voiceId": MURF_VOICE_ID,
        "model": "FALCON",
        "locale": "en-US",
        "sampleRate": 24000,
        "format": "MP3",
    }
    headers = {
        "Content-Type": "application/json",
        "api-key": MURF_API_KEY,
    }

    upstream = requests.post(
        MURF_URL,
        headers=headers,
        json=payload,
        stream=True,
        timeout=(10, 120),
    )
    try:
        upstream.raise_for_status()
    except requests.RequestException as exc:
        details = upstream.text[:1000]
        status = upstream.status_code
        upstream.close()
        raise RuntimeError(f"Murf API returned HTTP {status}: {details}") from exc
    return upstream


def stream_audio(upstream):
    """Stream MP3 chunks as newline-delimited Base64 for the current frontend."""
    try:
        for chunk in upstream.iter_content(chunk_size=4096):
            if chunk:
                yield base64.b64encode(chunk).decode("ascii") + "\n"
    except requests.RequestException:
        # Headers may already have been sent; log the streaming failure.
        app.logger.exception("Error while streaming Murf audio")
    finally:
        upstream.close()


def audio_response(text, question_number=None, interview_complete=False):
    """Build the response format expected by the current frontend."""
    upstream = request_murf_audio(text)
    headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "X-Interview-Complete": "true" if interview_complete else "false",
    }
    if question_number is not None:
        headers["X-Question-Number"] = str(question_number)
    return Response(
        stream_audio(upstream),
        content_type="text/plain; charset=utf-8",
        headers=headers,
    )


@app.get("/")
def home():
    return jsonify({
        "status": "running",
        "message": "AI Interview API is ready",
    }), 200


@app.post("/start-interview")
def start_interview():
    global agent, question_count, current_subject

    try:
        data = request.get_json(silent=True) or {}
        subject = str(data.get("subject") or "Python").strip()
        if not subject:
            return jsonify({"error": "Interview subject is required"}), 400

        with state_lock:
            current_subject = subject
            question_count = 1
            agent = create_interview_agent()
            config = {"configurable": {"thread_id": thread_id}}
            system_prompt = INTERVIEW_PROMPT.format(subject=current_subject)

            result = agent.invoke(
                {
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {
                            "role": "user",
                            "content": (
                                f"Start the {current_subject} interview. "
                                "Greet the candidate briefly and ask question 1 of 5."
                            ),
                        },
                    ]
                },
                config=config,
            )
            question = latest_message_text(result)

        app.logger.info("Generated question 1 for subject: %s", subject)
        return audio_response(question, question_number=1)

    except Exception as exc:
        app.logger.exception("Failed to start interview")
        return jsonify({"error": str(exc)}), 500


@app.post("/submit-answer")
def submit_answer():
    global question_count, agent

    temp_path = None
    try:
        if "audio" not in request.files:
            return jsonify({"error": "Missing audio file in form field 'audio'"}), 400

        with state_lock:
            if agent is None or not current_subject:
                return jsonify({"error": "Start an interview before submitting an answer"}), 400

            audio_file = request.files["audio"]
            with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_file:
                temp_path = temp_file.name
            audio_file.save(temp_path)

            answer = speech_to_text(temp_path)
            if not answer:
                answer = "I could not detect a spoken answer."

            app.logger.info("Answer to question %s: %s", question_count, answer)
            config = {"configurable": {"thread_id": thread_id}}

            # Add the candidate's transcribed answer to the interview history.
            agent.invoke(
                {"messages": [{"role": "user", "content": f"My answer: {answer}"}]},
                config=config,
            )

            # After answering question five, do not ask a sixth question.
            if question_count >= 5:
                closing_result = agent.invoke(
                    {
                        "messages": [{
                            "role": "user",
                            "content": (
                                "The candidate has answered question 5 of 5. "
                                "Thank them and say the interview is complete. "
                                "Do not ask another question. Keep it to two sentences."
                            ),
                        }]
                    },
                    config=config,
                )
                closing_text = latest_message_text(closing_result)
                return audio_response(
                    closing_text,
                    question_number=5,
                    interview_complete=True,
                )

            next_number = question_count + 1
            next_prompt = (
                f"The candidate has just answered question {question_count} of 5. "
                f"Their actual transcribed answer was: {answer!r}\n"
                "Briefly acknowledge the answer accurately, then ask exactly one "
                f"next question, question {next_number} of 5. Adapt it to the answer. "
                "Do not invent details. Keep the entire response under three sentences."
            )
            result = agent.invoke(
                {"messages": [{"role": "user", "content": next_prompt}]},
                config=config,
            )
            question = latest_message_text(result)
            question_count = next_number

        app.logger.info("Generated question %s", next_number)
        return audio_response(question, question_number=next_number)

    except Exception as exc:
        app.logger.exception("Failed to process interview answer")
        return jsonify({"error": str(exc)}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                app.logger.warning("Could not remove temporary audio file: %s", temp_path)


@app.post("/get-feedback")
def get_feedback():
    try:
        with state_lock:
            if agent is None or not current_subject:
                return jsonify({"error": "Complete or start an interview before requesting feedback"}), 400

            config = {"configurable": {"thread_id": thread_id}}
            prompt = FEEDBACK_PROMPT_TEMPLATE.format(subject=current_subject)
            result = agent.invoke(
                {"messages": [{"role": "user", "content": prompt}]},
                config=config,
            )
            raw_text = latest_message_text(result)

        # Be tolerant if the model wraps JSON in a Markdown code fence.
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].strip()

        feedback = json.loads(cleaned)
        if not isinstance(feedback, dict):
            raise ValueError("Feedback response was not a JSON object.")

        score = feedback.get("candidate_score")
        if not isinstance(score, int) or not 1 <= score <= 5:
            raise ValueError("Feedback candidate_score must be an integer from 1 to 5.")

        return jsonify({"success": True, "feedback": feedback}), 200

    except json.JSONDecodeError as exc:
        app.logger.exception("Model returned invalid JSON feedback")
        return jsonify({
            "error": "The model returned invalid JSON feedback. Please try again.",
            "details": str(exc),
        }), 502
    except Exception as exc:
        app.logger.exception("Failed to generate interview feedback")
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True,
        use_reloader=False,
    )
