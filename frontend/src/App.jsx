import React, { useEffect, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000';

const SUBJECTS = [
  { name: 'Self Introduction', icon: 'fas fa-user', color: 'blue', bgClass: 'bg-blue-500/20', iconClass: 'text-blue-400' },
  { name: 'Generative AI', icon: 'fas fa-brain', color: 'purple', bgClass: 'bg-purple-500/20', iconClass: 'text-purple-400' },
  { name: 'Python', icon: 'fab fa-python', color: 'yellow', bgClass: 'bg-yellow-500/20', iconClass: 'text-yellow-400' },
  { name: 'English', icon: 'fas fa-language', color: 'green', bgClass: 'bg-green-500/20', iconClass: 'text-green-400' },
  { name: 'HTML', icon: 'fab fa-html5', color: 'orange', bgClass: 'bg-orange-500/20', iconClass: 'text-orange-400' },
  { name: 'CSS', icon: 'fab fa-css3-alt', color: 'blue', bgClass: 'bg-blue-500/20', iconClass: 'text-blue-400' },
];

const PROFILE_IMAGE =
  'https://www.whiteroomstudio.com.sg/wordpress/wp-content/uploads/2021/10/professional-headshot-photography-linkedin-singapore-5.jpeg';

async function getErrorMessage(response) {
  const data = await response.json().catch(() => ({}));
  return data.error || `Request failed with status ${response.status}`;
}

function decodeBase64(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function App() {
  const [subject, setSubject] = useState(null);
  const [phase, setPhase] = useState('welcome');
  const [questionNumber, setQuestionNumber] = useState(1);
  const [status, setStatus] = useState('Select a topic from the sidebar to begin');
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [recordedBlob, setRecordedBlob] = useState(null);
  const recorderRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => () => {
    if (recorderRef.current?.state !== 'inactive') {
      recorderRef.current?.stop();
    }
    audioRef.current?.pause();
  }, []);

  function selectSubject(nextSubject) {
    audioRef.current?.pause();
    audioRef.current = null;
    setSubject(nextSubject);
    setPhase('selected');
    setQuestionNumber(1);
    setStatus('Click Start Interview to begin');
    setFeedbackVisible(false);
    setFeedback(null);
    setFeedbackError('');
    setRecordedBlob(null);
  }

  function resetInterview() {
    audioRef.current?.pause();
    audioRef.current = null;
    setSubject(null);
    setPhase('welcome');
    setQuestionNumber(1);
    setStatus('Select a topic from the sidebar to begin');
    setFeedbackVisible(false);
    setFeedback(null);
    setFeedbackLoading(false);
    setFeedbackError('');
    setRecordedBlob(null);
  }

  async function playAudioStream(response, interviewComplete) {
    if (!window.MediaSource || !MediaSource.isTypeSupported('audio/mpeg')) {
      throw new Error('This browser does not support streamed MP3 playback.');
    }

    const mediaSource = new MediaSource();
    const audioUrl = URL.createObjectURL(mediaSource);
    const audio = new Audio(audioUrl);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const queue = [];
    let sourceBuffer = null;
    let pendingText = '';
    let streamFinished = false;

    audioRef.current = audio;
    setPhase('speaking');
    setStatus('Natalie is speaking...');

    function pumpQueue() {
      if (!sourceBuffer || sourceBuffer.updating) return;
      if (queue.length > 0) {
        sourceBuffer.appendBuffer(queue.shift());
      } else if (streamFinished && mediaSource.readyState === 'open') {
        mediaSource.endOfStream();
      }
    }

    function appendLine(line) {
      const trimmedLine = line.trim();
      if (trimmedLine) queue.push(decodeBase64(trimmedLine));
      pumpQueue();
    }

    mediaSource.addEventListener('sourceopen', () => {
      sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
      sourceBuffer.addEventListener('updateend', pumpQueue);
      pumpQueue();
    }, { once: true });

    const playback = new Promise((resolve, reject) => {
      audio.addEventListener('ended', resolve, { once: true });
      audio.addEventListener('error', () => reject(new Error('Audio playback failed.')), { once: true });
      audio.play().catch(reject);
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        pendingText += decoder.decode(value, { stream: true });
        const lines = pendingText.split('\n');
        pendingText = lines.pop() || '';
        lines.forEach(appendLine);
      }

      pendingText += decoder.decode();
      if (pendingText.trim()) appendLine(pendingText);
      streamFinished = true;
      pumpQueue();
      await playback;
      setPhase(interviewComplete ? 'complete' : 'ready');
      setStatus(interviewComplete ? 'Interview completed' : 'Click to record');
    } finally {
      reader.releaseLock();
      if (audioRef.current === audio) audioRef.current = null;
      URL.revokeObjectURL(audioUrl);
    }
  }

  async function startInterview() {
    setPhase('connecting');
    setStatus('Connecting...');

    try {
      const response = await fetch(`${API_BASE_URL}/start-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject }),
      });

      if (!response.ok || !response.headers.get('content-type')?.includes('text/plain')) {
        throw new Error(await getErrorMessage(response));
      }

      const number = response.headers.get('X-Question-Number');
      if (number) setQuestionNumber(Number(number));
      await playAudioStream(response, false);
    } catch (error) {
      setPhase('selected');
      setStatus(error.message || 'Could not connect to the backend');
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatus('Audio recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = 'audio/webm;codecs=opus';
      const options = MediaRecorder.isTypeSupported(preferredType)
        ? { mimeType: preferredType }
        : undefined;
      const recorder = new MediaRecorder(stream, options);
      const chunks = [];

      recorderRef.current = recorder;
      setRecordedBlob(null);
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        setRecordedBlob(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        stream.getTracks().forEach((track) => track.stop());
        setPhase('recorded');
        setStatus('Recording complete');
      }, { once: true });
      recorder.start();
      setPhase('recording');
      setStatus('Recording...');
    } catch (error) {
      setStatus(error.message || 'Microphone access was denied.');
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  async function submitAnswer() {
    if (!recordedBlob) return;

    setPhase('submitting');
    setStatus('Submitting answer...');
    const formData = new FormData();
    formData.append('audio', recordedBlob, 'answer.webm');

    try {
      const response = await fetch(`${API_BASE_URL}/submit-answer`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok || !response.headers.get('content-type')?.includes('text/plain')) {
        throw new Error(await getErrorMessage(response));
      }

      const number = response.headers.get('X-Question-Number');
      const interviewComplete = response.headers.get('X-Interview-Complete') === 'true';
      if (number) setQuestionNumber(Number(number));
      setRecordedBlob(null);
      await playAudioStream(response, interviewComplete);
      if (interviewComplete) setFeedbackVisible(true);
    } catch (error) {
      setPhase('ready');
      setStatus(error.message || 'Could not submit the recorded answer');
    }
  }

  async function getFeedback() {
    setFeedbackVisible(true);
    setFeedbackLoading(true);
    setFeedbackError('');

    try {
      const response = await fetch(`${API_BASE_URL}/get-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Could not generate feedback.');
      setFeedback(data.feedback);
    } catch (error) {
      setFeedbackError(error.message || 'Could not generate feedback.');
    } finally {
      setFeedbackLoading(false);
    }
  }

  function endInterview() {
    if (!window.confirm('End interview and get feedback?')) return;
    setPhase('complete');
    setStatus('Interview ended');
    getFeedback();
  }

  const selectedSubject = SUBJECTS.find((item) => item.name === subject);
  const canEndInterview = ['ready', 'recorded', 'complete'].includes(phase);
  const score = feedback?.candidate_score || 0;
  const scoreOffset = 251.2 - (score / 5) * 251.2;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <aside className="w-full lg:w-1/5 sidebar-gradient border-b lg:border-b-0 lg:border-r border-zinc-800/50 p-4 lg:p-6 flex flex-col">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-gradient-to-br from-[#667eea] to-[#764ba2] rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/30">
            <i className="fas fa-robot text-white text-xl" aria-hidden="true" />
          </div>
          <span className="font-space font-bold text-2xl gradient-heading">AI Interview</span>
        </div>

        <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Select Topic</h2>
        <div className="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0">
          {SUBJECTS.map((item) => (
            <button
              key={item.name}
              type="button"
              className={`subject-btn flex items-center gap-3 bg-zinc-900/30 hover:bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-500 rounded-xl p-3 transition-all duration-300 text-left whitespace-nowrap flex-shrink-0 ${subject === item.name ? 'active' : ''}`}
              onClick={() => selectSubject(item.name)}
              aria-pressed={subject === item.name}
            >
              <span className={`w-9 h-9 ${item.bgClass} rounded-lg flex items-center justify-center`}>
                <i className={`${item.icon} ${item.iconClass}`} aria-hidden="true" />
              </span>
              <span className="font-medium text-sm text-white">{item.name}</span>
            </button>
          ))}
        </div>

        <div className="mt-auto pt-6 hidden lg:block">
          <p className="text-zinc-500 text-xs">Powered by AI</p>
        </div>
      </aside>

      <main className="flex-1 lg:w-4/5 flex flex-col bg-black">
        <header className="px-4 lg:px-8 py-6 lg:py-8 border-b border-zinc-800/50">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="font-space font-bold text-3xl lg:text-5xl xl:text-6xl mb-3">
              <span className="gradient-text">Master Your Interview</span>
            </h1>
            <p className="text-gray-300 text-base lg:text-lg font-light">
              Ace Your Technical Interviews with AI-Powered Practice and Feedback
            </p>
          </div>
        </header>

        <div className="flex-1 p-4 lg:p-8 overflow-y-auto">
          {!subject ? (
            <section className="h-full flex flex-col items-center justify-center text-center py-8">
              <div className="w-28 h-28 lg:w-36 lg:h-36 bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 rounded-full flex items-center justify-center mb-6 border border-zinc-700/30 glow-border">
                <i className="fas fa-microphone text-4xl lg:text-5xl text-zinc-400" aria-hidden="true" />
              </div>
              <h2 className="font-space text-2xl lg:text-3xl font-bold gradient-heading mb-3">Ready to Practice?</h2>
              <p className="text-gray-400 text-base lg:text-lg">Select a topic from the sidebar to begin</p>
            </section>
          ) : (
            <section>
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <span className="bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white px-5 py-2 rounded-full font-semibold shadow-lg">
                    {subject}
                  </span>
                  <i className={`${selectedSubject?.icon} text-2xl ${selectedSubject?.iconClass}`} aria-hidden="true" />
                </div>
                <span className="text-gray-300 text-base font-medium">
                  Question <span className="text-white font-bold text-lg">{questionNumber}</span>/5
                </span>
              </div>

              <div className="flex flex-col items-center mb-6">
                <div className="w-44 h-44 lg:w-56 lg:h-56 xl:w-64 xl:h-64 rounded-full overflow-hidden border-4 border-zinc-700/50 mb-4 shadow-2xl">
                  <img src={PROFILE_IMAGE} alt="Natalie" className="w-full h-full object-cover" />
                </div>
                <p className="text-gray-300 text-lg lg:text-xl font-medium">Natalie</p>
              </div>

              {phase === 'speaking' && (
                <div className="max-w-2xl mx-auto mb-6">
                  <div className="flex justify-center items-center gap-3 p-5 bg-zinc-900/50 rounded-2xl border border-zinc-800/50">
                    <div className="flex gap-2" aria-hidden="true">
                      <span className="w-3 h-3 bg-[#667eea] rounded-full animate-bounce" />
                      <span className="w-3 h-3 bg-[#764ba2] rounded-full animate-bounce [animation-delay:200ms]" />
                      <span className="w-3 h-3 bg-[#f093fb] rounded-full animate-bounce [animation-delay:400ms]" />
                    </div>
                    <span className="text-gray-200 ml-2 font-medium">Natalie is speaking...</span>
                  </div>
                </div>
              )}

              <div className="flex flex-col items-center gap-4 mb-6">
                {phase === 'selected' && (
                  <button
                    type="button"
                    onClick={startInterview}
                    className="bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white px-8 py-3 rounded-full font-bold text-base hover:shadow-lg hover:shadow-purple-500/30 transition-all duration-300"
                  >
                    Start Interview
                  </button>
                )}

                {['connecting', 'submitting'].includes(phase) && (
                  <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-full bg-zinc-800/80 flex items-center justify-center border-2 border-zinc-700/50" aria-label="Please wait">
                    <i className="fas fa-spinner fa-spin text-2xl text-gray-300" aria-hidden="true" />
                  </div>
                )}

                {!['welcome', 'selected', 'connecting', 'submitting', 'complete'].includes(phase) && (
                  <button
                    type="button"
                    disabled={phase === 'speaking' || phase === 'recorded'}
                    onClick={phase === 'recording' ? stopRecording : startRecording}
                    aria-label={phase === 'recording' ? 'Stop recording' : 'Start recording'}
                    className={`w-20 h-20 lg:w-24 lg:h-24 rounded-full bg-zinc-800/80 text-gray-300 flex items-center justify-center transition-all duration-300 border-2 border-zinc-700/50 hover:border-zinc-500 ${phase === 'recording' ? 'bg-red-500 text-white recording-active' : ''}`}
                  >
                    <i className={`fas ${phase === 'recording' ? 'fa-stop' : 'fa-microphone'} text-2xl lg:text-3xl`} aria-hidden="true" />
                  </button>
                )}

                <p className="text-gray-400 text-base" role="status" aria-live="polite">{status}</p>

                {phase === 'recorded' && (
                  <button
                    type="button"
                    onClick={submitAnswer}
                    className="bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white px-8 py-3 rounded-full font-bold text-base hover:shadow-lg hover:shadow-purple-500/30 transition-all duration-300"
                  >
                    Submit Answer
                  </button>
                )}
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={endInterview}
                  disabled={!canEndInterview || feedbackLoading}
                  className="border-2 border-zinc-700 text-gray-300 px-6 py-2.5 rounded-xl transition-all duration-300 hover:border-red-500/50 hover:text-red-400 font-medium text-sm"
                >
                  End Interview
                </button>
              </div>

              {feedbackVisible && (
                <section className="mt-10 pt-6 border-t border-zinc-800/50" aria-live="polite">
                  {!feedback && (
                    <div className="text-center mb-6">
                      <p className="text-gray-300 mb-4 text-base">Interview completed!</p>
                      {feedbackError && <p className="text-red-300 mb-4">{feedbackError}</p>}
                      <button
                        type="button"
                        onClick={getFeedback}
                        disabled={feedbackLoading}
                        className="bg-gradient-to-r from-[#667eea] via-[#764ba2] to-[#f093fb] text-white px-8 py-3 rounded-full font-bold text-base hover:opacity-90 transition-all duration-300 shadow-lg shadow-purple-500/30"
                      >
                        {feedbackLoading ? 'Generating...' : feedbackError ? 'Retry Feedback' : 'Get Feedback'}
                      </button>
                    </div>
                  )}

                  {feedback && (
                    <div className="max-w-xl mx-auto">
                      <div className="flex flex-col sm:flex-row justify-between items-start gap-6 mb-6">
                        <div>
                          <p className="text-gray-400 text-xs mb-1 uppercase tracking-wider">Detailed Feedback</p>
                          <h2 className="font-space text-2xl font-bold gradient-heading">{feedback.subject || subject}</h2>
                        </div>
                        <div className="text-center">
                          <div className="relative w-24 h-24">
                            <svg className="w-24 h-24 -rotate-90" aria-label={`Score: ${score} out of 5`}>
                              <circle cx="48" cy="48" r="40" stroke="#27272a" strokeWidth="5" fill="none" />
                              <circle
                                cx="48"
                                cy="48"
                                r="40"
                                stroke="url(#scoreGradient)"
                                strokeWidth="5"
                                fill="none"
                                strokeDasharray="251.2"
                                strokeDashoffset={scoreOffset}
                                strokeLinecap="round"
                                className="transition-all duration-1000"
                              />
                              <defs>
                                <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                  <stop offset="0%" stopColor="#667eea" />
                                  <stop offset="100%" stopColor="#764ba2" />
                                </linearGradient>
                              </defs>
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-2xl font-bold text-white">{score}</span>
                              <span className="text-xs text-gray-400">/5</span>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400 mt-1">Score</p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <article className="bg-zinc-900/30 rounded-xl p-5 border border-zinc-800/50">
                          <h3 className="text-lg font-bold mb-2 flex items-center gap-2 gradient-heading">
                            <i className="fas fa-star text-yellow-400" aria-hidden="true" />Feedback
                          </h3>
                          <p className="text-gray-200 leading-relaxed text-sm">{feedback.feedback || 'No feedback available'}</p>
                        </article>
                        <article className="bg-zinc-900/30 rounded-xl p-5 border border-zinc-800/50">
                          <h3 className="text-lg font-bold mb-2 flex items-center gap-2 gradient-heading">
                            <i className="fas fa-chart-line text-cyan-400" aria-hidden="true" />Areas of Improvement
                          </h3>
                          <p className="text-gray-200 leading-relaxed text-sm">
                            {feedback.areas_of_improvement || 'No suggestions available'}
                          </p>
                        </article>
                      </div>

                      <div className="text-center mt-8">
                        <button
                          type="button"
                          onClick={resetInterview}
                          className="bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white px-10 py-3 rounded-xl font-bold text-base hover:shadow-lg hover:shadow-purple-500/30 transition-all duration-300"
                        >
                          Start New Interview
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
