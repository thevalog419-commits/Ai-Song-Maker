import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    keyConfigured: Boolean(REPLICATE_TOKEN)
  });
});

function durationText(value) {
  const map = {
    "30 seconds": "approximately 30 seconds",
    "60 seconds": "approximately 1 minute",
    "2 minutes": "approximately 2 minutes",
    "3 minutes": "approximately 3 minutes"
  };

  return map[value] || "approximately 1 minute";
}

function normalizeLyrics(value) {
  if (!value) return "";

  const text = String(value).trim();

  if (
    text.toLowerCase() === "generate automatically" ||
    text.toLowerCase() === "auto" ||
    text.toLowerCase() === "automatic"
  ) {
    return "";
  }

  return text.slice(0, 3500);
}

async function createPrediction(input) {
  const response = await fetch(
    "https://api.replicate.com/v1/models/minimax/music-2.6/predictions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait"
      },
      body: JSON.stringify({ input })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.detail ||
      data?.error ||
      `Replicate API error (${response.status})`
    );
  }

  return data;
}

async function getPrediction(id) {
  const response = await fetch(
    `https://api.replicate.com/v1/predictions/${id}`,
    {
      headers: {
        Authorization: `Bearer ${REPLICATE_TOKEN}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.detail ||
      data?.error ||
      `Prediction error (${response.status})`
    );
  }

  return data;
}

async function waitForPrediction(id) {
  const maxAttempts = 90;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const prediction = await getPrediction(id);

    if (prediction.status === "succeeded") {
      return prediction;
    }

    if (
      prediction.status === "failed" ||
      prediction.status === "canceled"
    ) {
      throw new Error(
        prediction.error ||
        `Music generation ${prediction.status}`
      );
    }

    await new Promise(resolve => setTimeout(resolve, 4000));
  }

  throw new Error("Music generation timed out. Please try again.");
}

app.post("/api/generate-song", async (req, res) => {
  try {
    if (!REPLICATE_TOKEN) {
      return res.status(500).json({
        error: "REPLICATE_API_TOKEN is not configured on Render."
      });
    }

    const {
      prompt = "",
      language = "Hindi",
      mood = "Emotional",
      duration = "60 seconds",
      voice = "Male",
      genre = "Pop",
      lyrics = ""
    } = req.body || {};

    if (!prompt.trim()) {
      return res.status(400).json({
        error: "Please enter a song prompt."
      });
    }

    const instrumental =
      String(voice).toLowerCase() === "instrumental";

    const userLyrics = normalizeLyrics(lyrics);

    const musicPrompt = [
      `Create ${durationText(duration)} music.`,
      `Language: ${language}.`,
      `Mood: ${mood}.`,
      `Genre: ${genre}.`,
      instrumental
        ? "Instrumental only, no vocals."
        : `Vocal: ${voice}.`,
      `User song idea: ${prompt.trim()}.`,
      "Create an original song.",
      "Do not imitate any named artist.",
      "Do not use copyrighted lyrics."
    ].join(" ");

    const input = {
      prompt: musicPrompt,
      audio_format: "mp3",
      sample_rate: 44100,
      bitrate: 256000,
      is_instrumental: instrumental
    };

    if (instrumental) {
      input.lyrics_optimizer = false;
    } else if (userLyrics) {
      input.lyrics = userLyrics;
      input.lyrics_optimizer = false;
    } else {
      input.lyrics_optimizer = true;
    }

    console.log("Starting MiniMax Music 2.6 generation...");

    const created = await createPrediction(input);

    let prediction = created;

    if (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled"
    ) {
      prediction = await waitForPrediction(prediction.id);
    }

    const output = prediction.output;

    if (!output) {
      throw new Error("Replicate returned no audio output.");
    }

    const audioUrl =
      typeof output === "string"
        ? output
        : Array.isArray(output)
          ? output[0]
          : output.url;

    if (!audioUrl) {
      throw new Error("Could not find generated audio URL.");
    }

    console.log("Song generated successfully.");

    const audioResponse = await fetch(audioUrl);

    if (!audioResponse.ok) {
      throw new Error("Could not download generated audio.");
    }

    const audioBuffer = Buffer.from(
      await audioResponse.arrayBuffer()
    );

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="ai-song.mp3"'
    );

    res.send(audioBuffer);

  } catch (error) {
    console.error("Song generation error:", error);

    res.status(500).json({
      error: error.message || "Music generation failed."
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI Song Maker running on port ${PORT}`);
});
