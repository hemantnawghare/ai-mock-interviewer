# 🎙️ AI Mock Interviewer

An AI-powered mock interview application that helps users practice technical interviews through dynamically generated questions and AI-generated voice. The project combines a React frontend with a Python backend to deliver an interactive interview experience.

## ✨ Features

- **AI-Generated Interview Questions** — Generates interview questions based on the selected subject.
- **Adaptive Questioning** — Uses conversational AI to generate relevant follow-up questions based on the interview context.
- **Text-to-Speech** — Converts interview questions into natural-sounding speech using Murf AI.
- **LLM Integration** — Uses LangChain and Google's Gemini models for AI-powered interview question generation.
- **Interview Session Memory** — Maintains conversation state during an interview session using LangGraph's in-memory checkpointing.
- **REST API** — Connects the React frontend to the Python backend through HTTP endpoints.
- **Modern Frontend** — Built with React and Vite for a responsive development experience.

## 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React.js, Vite, JavaScript, CSS |
| Backend | Python, Flask, Flask-CORS |
| AI / LLM | LangChain, Google Gemini |
| Agent Framework | LangGraph |
| Voice Generation | Murf AI |
| API Communication | REST API, HTTP |

## 🏗️ Project Architecture

```text
AI Mock Interviewer
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── package.json
│   └── vite.config.js
│
└── backend/
    ├── Flask application
    ├── AI interview agent
    ├── Gemini integration
    └── Murf AI voice generation
```

### How It Works

1. The user opens the React application and starts an interview.
2. The frontend sends an HTTP request to the Flask backend.
3. The backend invokes the LangChain agent powered by a Gemini model.
4. The agent generates interview questions based on the selected subject and conversation context.
5. Murf AI converts the generated question into speech.
6. The backend returns the question and audio data to the frontend for presentation.

## 🚀 Getting Started

### Prerequisites

Install the following before running the project:

- Python 3.10 or a compatible version supported by your backend dependencies
- Node.js and npm
- Google AI API key
- Murf AI API key

### 1. Clone the Repository

```bash
git clone https://github.com/hemantnawghare/ai-mock-interviewer.git
cd ai-mock-interviewer
```

### 2. Configure the Backend

Navigate to the backend directory:

```bash
cd backend
```

Create and activate a virtual environment.

**Windows PowerShell:**

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

Install the backend dependencies using the project's dependency file, if provided:

```bash
pip install -r requirements.txt
```

Create a `.env` file inside the backend directory and configure your API credentials:

```env
GOOGLE_API_KEY=your_google_api_key
MURF_API_KEY=your_murf_api_key
```

Replace the placeholder values with your own API keys. Never commit your `.env` file to GitHub.

Start the Flask application using the entry-point file configured in your backend. For example, if the entry point is `app.py`:

```bash
python app.py
```

The backend is configured to run on port `5000`.

### 3. Configure the Frontend

Open a second terminal and navigate to the project root:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL displayed by Vite in your terminal, usually:

```text
http://localhost:5173
```

Ensure that the frontend's API configuration points to the running Flask backend.

> **Note:** Adjust the backend startup command and dependency installation steps to match the actual files in your repository.

## 🔑 Environment Variables

| Variable | Purpose |
|---|---|
| `GOOGLE_API_KEY` | Authenticates requests to Google's AI services |
| `MURF_API_KEY` | Authenticates requests to Murf AI for voice generation |

Keep API keys private and store them in environment variables rather than hardcoding them into application code.

## 📡 Backend API

### Start Interview

**Endpoint:** `POST /start-interview`

**Default subject:** Python

The endpoint starts the interview question-generation flow. The backend uses the configured AI agent to generate interview questions and integrates Murf AI to produce corresponding audio.

The current implementation is designed around a five-question interview and returns audio data encoded in Base64 for frontend consumption.

Example request:

```json
{
  "subject": "Python"
}
```

The exact request fields and response structure should match the current Flask route implementation.

## 🔮 Future Enhancements

- Speech-to-text for capturing spoken answers.
- AI-powered evaluation of candidate responses.
- Feedback on technical accuracy, communication, and areas for improvement.
- Final interview report with scores and recommendations.
- Interview history and progress tracking.
- Support for additional technical subjects and job roles.
- User authentication and personalized interview sessions.

## 🔒 Security

- Store API credentials in environment variables.
- Add `.env`, virtual environments, and `node_modules` to `.gitignore`.
- Never expose private API keys in frontend code.
- Configure CORS to allow only trusted frontend origins when deploying.
- Avoid committing credentials or other sensitive information.

## 👨‍💻 Author

**Hemant Nawghare**

GitHub: [@hemantnawghare](https://github.com/hemantnawghare)

## 📄 License

This project is available for learning and development. Add a `LICENSE` file to specify the terms under which others may use, modify, or distribute the project.
