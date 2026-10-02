import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ELEVENLABS_API_KEY;

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, keyConfigured: Boolean(API_KEY) });
});

function durationToMs(value) {
  const map = {
    '30 seconds': 30000,
    '60 seconds': 60000,
    '2 minutes': 120000,
    '3 minutes': 180000
  };
  return map[value] || 60000;
}

app.post('/api/generate-song', async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({ error: 'ELEVENLABS_API_KEY is not configured on the server.' });
    }

    const {
      prompt = '',
      language = 'Hindi',
      mood = 'Emotional',
      duration = '60 seconds',
      voice = 'Male',
      genre = 'Pop',
      lyrics = 'Generate automatically'
    } = req.body || {};

    if (!prompt.trim()) {
      return res.status(400).json({ error: 'Please enter a song idea.' });
    }

    const instrumental = voice === 'Instrumental';
    const safePrompt = [
      `Create an original ${duration} ${language} song.`,
      `Theme/idea: ${prompt.trim()}`,
      `Mood: ${mood}.`,
      `Genre: ${genre}.`,
      instrumental ? 'Instrumental only, no vocals.' : `${voice} vocals.`,
      lyrics === 'Generate automatically' ? 'Write original lyrics that fit the theme.' : 'Use the user-provided lyrics/theme as supplied.',
      'Do not imitate any named artist or existing copyrighted song.'
    ].join(' ');

    const response = await fetch('https://api.elevenlabs.io/v1/music', {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: safePrompt,
        music_length_ms: durationToMs(duration),
        model_id: 'music_v2_5',
        force_instrumental: instrumental,
        output_format: 'mp3_44100_128'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: 'ElevenLabs music generation failed.',
        details: errorText.slice(0, 2000)
      });
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Content-Disposition', 'inline; filename="ai-song.mp3"');
    res.send(audioBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error while generating the song.' });
  }
});

app.listen(PORT, () => {
  console.log(`AI Song Maker running on port ${PORT}`);
});
