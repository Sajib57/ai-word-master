export default {
  async fetch(request, env) {
    // CORS Headers যাতে Vercel ফ্রন্টএন্ড থেকে কল করা যায়
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const { action } = body;

      if (action === "start_round") {
        const data = await handleStartRound(body, env.GEMINI_API_KEY);
        return jsonResponse(data, corsHeaders);
      }

      if (action === "evaluate_guess") {
        const data = await handleEvaluateGuess(body, env.GEMINI_API_KEY);
        return jsonResponse(data, corsHeaders);
      }

      if (action === "session_summary") {
        const data = await handleSessionSummary(body, env.GEMINI_API_KEY);
        return jsonResponse(data, corsHeaders);
      }

      return jsonResponse({ error: "Invalid action" }, corsHeaders, 400);
    } catch (err) {
      return jsonResponse({ error: err.message }, corsHeaders, 500);
    }
  },
};

function jsonResponse(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function callGemini(prompt, schema, apiKey) {
  const models = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.1-pro-preview"];
  let lastError = "";

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.75,
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const result = await res.json();
        const rawText = result.candidates[0].content.parts[0].text;
        return JSON.parse(rawText);
      }

      lastError = await res.text();
      // যদি সার্ভার ব্যস্ত থাকে (503 বা 429), তবে ১ সেকেন্ড অপেক্ষা করে আবার চেষ্টা করবে
      if (res.status === 503 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      break;
    }
  }

  throw new Error(`Gemini API Error: ${lastError}`);
}
// ১. নতুন রাউন্ড ও চ্যালেঞ্জ তৈরি (Word + Hint + Difficulty)
async function handleStartRound({ difficulty, category, previousWords = [] }, apiKey) {
  const prompt = `
    You are the AI Brain of an advanced Word Guessing Game.
    Generate a new round.
    - Target Difficulty: ${difficulty}
    - Category / Challenge Theme: ${category}
    - Avoid these previously used words: ${previousWords.join(", ")}

    Tasks:
    1. Select ONE single English secret word matching the difficulty and category.
    2. Create an engaging, clever first riddle/hint (e.g., "I am a device used to..."). Do NOT reveal the word.
    3. Define a subtle challenge modifier (e.g., "Riddle Mode", "Scientific Clue", "Everyday Object").
  `;

  const schema = {
    type: "OBJECT",
    properties: {
      secret_word: { type: "STRING" },
      first_hint: { type: "STRING" },
      challenge_type: { type: "STRING" },
      word_length: { type: "INTEGER" },
    },
    required: ["secret_word", "first_hint", "challenge_type", "word_length"],
  };

  return await callGemini(prompt, schema, apiKey);
}

// ২. প্লেয়ারের উত্তর যাচাই, Semantic Analysis, Next Hint এবং Explanation
async function handleEvaluateGuess({ secret_word, user_guess, attempt, difficulty, history }, apiKey) {
  const prompt = `
    You are the AI Judge and Game Master.
    - Secret Word: "${secret_word}"
    - Player's Guess: "${user_guess}"
    - Attempt Number: ${attempt} of 5
    - Current Difficulty: ${difficulty}
    - Previous Guesses: ${history.join(", ")}

    Evaluate the guess strictly using AI semantic reasoning (NOT simple string matching):
    1. is_correct: true ONLY if "${user_guess}" means the exact same concept as "${secret_word}" (allowing singular/plural or exact spelling variations, NOT broad categories like "Computer" for "Telephone").
    2. semantic_closeness: Rate from 0 to 100 how close the player's guess is in meaning/domain to "${secret_word}".
    3. status_message: A clear bilingual (English + Bengali) response like:
       - If wrong: "Incorrect! তোমার অনুমানটি কাছাকাছি, কিন্তু সঠিক নয়।" (adjust based on closeness).
       - If right: "Excellent! You guessed the correct word."
    4. next_hint: If incorrect, provide a sharper, progressive hint bridging "${user_guess}" toward "${secret_word}" without saying the word. If correct, leave empty.
    5. explanation: If correct OR attempt == 5, provide the meaning and an example sentence of "${secret_word}". Otherwise empty.
    6. recommended_next_difficulty: Suggest "Easy", "Medium", "Hard", or "Expert" based on how fast/accurately the player solved it.
  `;

  const schema = {
    type: "OBJECT",
    properties: {
      is_correct: { type: "BOOLEAN" },
      semantic_closeness: { type: "INTEGER" },
      status_message: { type: "STRING" },
      next_hint: { type: "STRING" },
      explanation: { type: "STRING" },
      recommended_next_difficulty: { type: "STRING" },
    },
    required: [
      "is_correct",
      "semantic_closeness",
      "status_message",
      "next_hint",
      "explanation",
      "recommended_next_difficulty",
    ],
  };

  return await callGemini(prompt, schema, apiKey);
}

// ৩. সেশন শেষে AI Performance Feedback
async function handleSessionSummary({ score, roundsPlayed, accuracyHistory }, apiKey) {
  const prompt = `
    Analyze this player's Word Guessing Game session:
    - Total Score: ${score}
    - Rounds Played: ${roundsPlayed}
    - Round Details: ${JSON.stringify(accuracyHistory)}

    Provide a short, encouraging AI Coach feedback (in Bengali mixed with English terms) highlighting their vocabulary strength and thinking pattern.
  `;

  const schema = {
    type: "OBJECT",
    properties: {
      coach_feedback: { type: "STRING" },
      player_title: { type: "STRING" },
    },
    required: ["coach_feedback", "player_title"],
  };

  return await callGemini(prompt, schema, apiKey);
}