import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ১. আপনার লাইভ Cloudflare Worker URL
const WORKER_API_URL = "https://ai-word-master-api.asraffoisal4.workers.dev";

// ২. আপনার Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDOHterZlsjF-rkR86I0duLtPKtBWC_qLQ",
  authDomain: "ai-word-master.firebaseapp.com",
  projectId: "ai-word-master",
  storageBucket: "ai-word-master.firebasestorage.app",
  messagingSenderId: "76624828452",
  appId: "1:76624828452:web:9d2d214195bb9b6c9b60b1"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// জরুরি ব্যাকআপ শব্দভাণ্ডার (যদি কখনো AI সার্ভার সাময়িক ব্যস্ত থাকে)
const BACKUP_CHALLENGES = [
  { secret_word: "CONFIDENCE", challenge_type: "Vocabulary Mode", word_length: 10, first_hint: "I am the quiet inner assurance in your own abilities that lets you step onto a stage or face a challenge without fear." },
  { secret_word: "FAITH", challenge_type: "Vocabulary Mode", word_length: 5, first_hint: "I am complete trust and belief in something or someone, even when you cannot see the outcome with your own eyes." },
  { secret_word: "ALGORITHM", challenge_type: "Riddle Mode", word_length: 9, first_hint: "I am a step-by-step recipe of logic that computers follow to solve problems." },
  { secret_word: "FIREWALL", challenge_type: "Riddle Mode", word_length: 8, first_hint: "I stand as a digital guard between a trusted network and untrusted traffic." },
  { secret_word: "DATABASE", challenge_type: "Riddle Mode", word_length: 8, first_hint: "I store organized collections of information so apps can retrieve them in milliseconds." },
  { secret_word: "COMPILER", challenge_type: "Riddle Mode", word_length: 8, first_hint: "I translate human-readable source code into machine language before execution." },
  { secret_word: "SATELLITE", challenge_type: "Riddle Mode", word_length: 9, first_hint: "I orbit high above Earth, relaying signals, weather data, and GPS coordinates." }
];

// Game State (Session Management)
let state = {
  playerName: "Player",
  score: 0,
  difficulty: "Medium",
  secretWord: "",
  attempts: 0,
  maxAttempts: 5,
  timer: 60,
  timerInterval: null,
  guessHistory: [],
  previousWords: [],
  sessionStats: []
};

// DOM Elements
const setupPanel = document.getElementById("setup-panel");
const gamePanel = document.getElementById("game-panel");
const reportPanel = document.getElementById("report-panel");
const hintsContainer = document.getElementById("hints-container");
const feedbackBox = document.getElementById("ai-feedback-box");
const explanationBox = document.getElementById("explanation-box");
const nextRoundBtn = document.getElementById("next-round-btn");

// Helper: Call Cloudflare Worker with 12s Timeout
async function callBackend(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(WORKER_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || "Server Error");
    }
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// Start Round
async function startRound() {
  const nameInput = document.getElementById("player-name").value.trim();
  if (nameInput) state.playerName = nameInput;
  const category = document.getElementById("category-select").value;

  setupPanel.classList.add("hidden");
  gamePanel.classList.remove("hidden");
  nextRoundBtn.classList.add("hidden");
  feedbackBox.classList.add("hidden");
  explanationBox.classList.add("hidden");

  const guessInput = document.getElementById("guess-input");
  const submitBtn = document.getElementById("submit-guess-btn");
  guessInput.disabled = true;
  submitBtn.disabled = true;

  hintsContainer.innerHTML = "<p>🤖 AI নতুন শব্দ ও চ্যালেঞ্জ তৈরি করছে...</p>";
  state.attempts = 0;
  state.guessHistory = [];
  updateStatsUI();

  let data;
  try {
    data = await callBackend({
      action: "start_round",
      difficulty: state.difficulty,
      category: category,
      previousWords: state.previousWords
    });
  } catch (err) {
    console.warn("AI busy, using backup challenge:", err.message);
    const available = BACKUP_CHALLENGES.filter(w => !state.previousWords.includes(w.secret_word.toLowerCase()));
    const pool = available.length > 0 ? available : BACKUP_CHALLENGES;
    data = pool[Math.floor(Math.random() * pool.length)];
  }

  state.secretWord = data.secret_word.toLowerCase();
  state.previousWords.push(state.secretWord);

  document.getElementById("challenge-badge").textContent = `🎯 ${data.challenge_type}`;
  document.getElementById("word-len-badge").textContent = `Letters: ${data.word_length}`;
  hintsContainer.innerHTML = `<div class="hint-item"><strong>Hint 1:</strong> ${data.first_hint}</div>`;
  document.getElementById("closeness-fill").style.width = "0%";
  document.getElementById("closeness-text").textContent = "0%";

  guessInput.disabled = false;
  submitBtn.disabled = false;
  guessInput.focus();

  startTimer();
}

// Timer Mechanic
function startTimer() {
  clearInterval(state.timerInterval);
  state.timer = 60;
  document.getElementById("timer").textContent = `${state.timer}s`;

  state.timerInterval = setInterval(() => {
    state.timer--;
    document.getElementById("timer").textContent = `${state.timer}s`;
    if (state.timer <= 0) {
      clearInterval(state.timerInterval);
      handleRoundOver(false, `⏰ সময় শেষ! সঠিক শব্দটি ছিল: <b>${state.secretWord.toUpperCase()}</b>`);
    }
  }, 1000);
}

// Handle Guess Submission (AI Evaluator)
document.getElementById("guess-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const inputEl = document.getElementById("guess-input");
  const submitBtn = document.getElementById("submit-guess-btn");
  const guess = inputEl.value.trim();
  if (!guess || !state.secretWord) return;

  inputEl.value = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "AI Checking...";

  state.attempts++;
  state.guessHistory.push(guess);
  updateStatsUI();

  let evalData;
  try {
    evalData = await callBackend({
      action: "evaluate_guess",
      secret_word: state.secretWord,
      user_guess: guess,
      attempt: state.attempts,
      difficulty: state.difficulty,
      history: state.guessHistory
    });
  } catch (err) {
    const isExact = guess.toLowerCase() === state.secretWord;
    evalData = {
      is_correct: isExact,
      semantic_closeness: isExact ? 100 : Math.min(85, Math.floor(Math.random() * 40) + 25),
      status_message: isExact ? "🎉 অসাধারণ! একদম সঠিক উত্তর!" : "কাছাকাছি যাচ্ছে, আবার চেষ্টা করুন!",
      next_hint: `শব্দটি '${state.secretWord[0].toUpperCase()}' অক্ষর দিয়ে শুরু এবং '${state.secretWord.slice(-1).toUpperCase()}' দিয়ে শেষ।`,
      explanation: `${state.secretWord.toUpperCase()} হলো প্রযুক্তির একটি গুরুত্বপূর্ণ ধারণা।`,
      recommended_next_difficulty: state.difficulty
    };
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Guess";

  // Update Semantic Closeness Meter
  document.getElementById("closeness-fill").style.width = `${evalData.semantic_closeness}%`;
  document.getElementById("closeness-text").textContent = `${evalData.semantic_closeness}%`;

  feedbackBox.classList.remove("hidden");
  feedbackBox.innerHTML = `<strong>Your Guess (${guess}):</strong> ${evalData.status_message}`;

  if (evalData.is_correct) {
    clearInterval(state.timerInterval);
    const roundPoints = (state.maxAttempts - state.attempts + 1) * 20 + state.timer;
    state.score += roundPoints;
    state.difficulty = evalData.recommended_next_difficulty || state.difficulty;
    state.sessionStats.push({ word: state.secretWord, solved: true, attempts: state.attempts });

    explanationBox.classList.remove("hidden");
    explanationBox.innerHTML = `📖 <strong>AI Word Insight:</strong> ${evalData.explanation}`;
    handleRoundOver(true);
  } else if (state.attempts >= state.maxAttempts) {
    clearInterval(state.timerInterval);
    state.difficulty = evalData.recommended_next_difficulty || state.difficulty;
    state.sessionStats.push({ word: state.secretWord, solved: false, attempts: state.attempts });

    explanationBox.classList.remove("hidden");
    explanationBox.innerHTML = `💀 সঠিক শব্দ: <b>${state.secretWord.toUpperCase()}</b><br>📖 ${evalData.explanation}`;
    handleRoundOver(false);
  } else {
    hintsContainer.innerHTML += `<div class="hint-item"><strong>Hint ${state.attempts + 1}:</strong> ${evalData.next_hint}</div>`;
  }
  updateStatsUI();
});

function handleRoundOver(won, customMsg = null) {
  if (customMsg) {
    feedbackBox.classList.remove("hidden");
    feedbackBox.innerHTML = customMsg;
  }
  document.getElementById("guess-input").disabled = true;
  document.getElementById("submit-guess-btn").disabled = true;
  nextRoundBtn.classList.remove("hidden");
}

nextRoundBtn.addEventListener("click", () => {
  document.getElementById("guess-input").disabled = false;
  document.getElementById("submit-guess-btn").disabled = false;
  startRound();
});

// End Session: Save to Firebase + Get AI Coach Feedback
document.getElementById("end-session-btn").addEventListener("click", async () => {
  clearInterval(state.timerInterval);
  gamePanel.classList.add("hidden");
  reportPanel.classList.remove("hidden");
  document.getElementById("coach-feedback-text").textContent = "🤖 AI আপনার পারফরম্যান্স বিশ্লেষণ করছে...";

  // Save score to Firebase
  if (state.score > 0) {
    try {
      await addDoc(collection(db, "leaderboard"), {
        name: state.playerName,
        score: state.score,
        rounds: state.sessionStats.length,
        createdAt: serverTimestamp()
      });
      loadLeaderboard();
    } catch (e) {
      console.error("Firebase save error:", e);
    }
  }

  try {
    const summary = await callBackend({
      action: "session_summary",
      score: state.score,
      roundsPlayed: state.sessionStats.length,
      accuracyHistory: state.sessionStats
    });
    document.getElementById("player-rank-title").textContent = `🏅 Rank: ${summary.player_title}`;
    document.getElementById("coach-feedback-text").textContent = summary.coach_feedback;
  } catch (e) {
    document.getElementById("player-rank-title").textContent = `🏅 Rank: Word Explorer (${state.score} pts)`;
    document.getElementById("coach-feedback-text").textContent = "দারুণ খেলেছেন! নিয়মিত অনুশীলন করলে আপনার শব্দভাণ্ডার আরও সমৃদ্ধ হবে।";
  }
});

async function loadLeaderboard() {
  const listEl = document.getElementById("leaderboard-list");
  try {
    const q = query(collection(db, "leaderboard"), orderBy("score", "desc"), limit(5));
    const snapshot = await getDocs(q);
    listEl.innerHTML = "";
    snapshot.forEach((doc, idx) => {
      const d = doc.data();
      listEl.innerHTML += `<li><span>#${idx + 1} ${d.name}</span><strong>${d.score} pts</strong></li>`;
    });
  } catch (e) {
    listEl.innerHTML = "<li>Firebase কনফিগার করলে লিডারবোর্ড দেখা যাবে।</li>";
  }
}

function updateStatsUI() {
  document.getElementById("score").textContent = state.score;
  document.getElementById("difficulty").textContent = state.difficulty;
  document.getElementById("attempts").textContent = `${state.attempts} / ${state.maxAttempts}`;
}

document.getElementById("start-btn").addEventListener("click", startRound);
loadLeaderboard();