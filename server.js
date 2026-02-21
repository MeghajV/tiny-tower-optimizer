import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.static("public")); // Serve frontend

const API_KEY = process.env.GEMINI_API_KEY;

app.post("/api/analyze", async (req, res) => {
  console.log("Request body size:", JSON.stringify(req.body).length);
  console.log("Request keys:", Object.keys(req.body));

  console.log("Request body received. Analyzing...");

  if (!req.body.base64Data || !req.body.mediaType || !req.body.prompt) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const { base64Data, mediaType, prompt } = req.body;

    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mediaType, data: base64Data }},
              { text: prompt }
            ]
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 2000 }
        })
      }
    );

    const data = await resp.json();
    if (data.error) {
      if (data.error.code == 429) {
        console.log("Gemini rate limit");
        return res.status(400).json({ error: "Gemini rate limit" });
      }
      console.error("Error:", data.error);
      return res.status(400).json({ error: data.error.message });
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});