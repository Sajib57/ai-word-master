import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ১. আপনার Cloudflare Worker URL এখানে দিন
const WORKER_API_URL = "https://ai-word-game-api.YOUR_SUBDOMAIN.workers.dev";

// ২. আপনার Firebase Config এখানে দিন (Firebase Console -> Project Settings থেকে পাবেন)
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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

// Helper: Call Cloudflare Worker
async function callBackend(payload) {
  const res = await fetch(WORKER_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return await res.json();
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

  hintsContainer.innerHTML = "<p>🤖 AI নতুন শব্দ ও চ্যালেঞ্জ তৈরি করছে...</p>";
  state.attempts = 0;
  state.guessHistory = [];
  updateStatsUI();

  const data = await callBackend({
    action: "start_round",
    difficulty: state.difficulty,
    category: category,
    previousWords: state.previousWords
  });

  state.secretWord = data.secret_word.toLowerCase();
  state.previousWords.push(state.secretWord);

  document.getElementById("challenge-badge").textContent = `🎯 ${data.challenge_type}`;
  document.getElementById("word-len-badge").textContent = `Letters: ${data.word_length}`;
  hintsContainer.innerHTML = `<div class="hint-item"><strong>Hint 1:</strong> ${data.first_hint}</div>`;
  document.getElementById("closeness-fill").style.width = "0%";
  document.getElementById("closeness-text").textContent = "0%";

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
  if (!guess) return;

  inputEl.value = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "AI Checking...";

  state.attempts++;
  state.guessHistory.push(guess);
  updateStatsUI();

  const evalData = await callBackend({
    action: "evaluate_guess",
    secret_word: state.secretWord,
    user_guess: guess,
    attempt: state.attempts,
    difficulty: state.difficulty,
    history: state.guessHistory
  });

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
    state.difficulty = evalData.recommended_next_difficulty;
    state.sessionStats.push({ word: state.secretWord, solved: true, attempts: state.attempts });

    explanationBox.classList.remove("hidden");
    explanationBox.innerHTML = `📖 <strong>AI Word Insight:</strong> ${evalData.explanation}`;
    handleRoundOver(true);
  } else if (state.attempts >= state.maxAttempts) {
    clearInterval(state.timerInterval);
    state.difficulty = evalData.recommended_next_difficulty;
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
    await addDoc(collection(db, "leaderboard"), {
      name: state.playerName,
      score: state.score,
      rounds: state.sessionStats.length,
      createdAt: serverTimestamp()
    });
    loadLeaderboard();
  }

  const summary = await callBackend({
    action: "session_summary",
    score: state.score,
    roundsPlayed: state.sessionStats.length,
    accuracyHistory: state.sessionStats
  });

  document.getElementById("player-rank-title").textContent = `🏅 Rank: ${summary.player_title}`;
  document.getElementById("coach-feedback-text").textContent = summary.coach_feedback;
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