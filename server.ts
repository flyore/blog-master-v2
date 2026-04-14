import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Operator API Keys (SaaS Mode)
  const OPERATOR_GEMINI_KEY = process.env.GEMINI_API_KEY;
  const OPERATOR_OPENAI_KEY = process.env.OPENAI_API_KEY;
  const OPERATOR_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const OPERATOR_SEARCH_KEY = process.env.GOOGLE_SEARCH_KEY;
  const OPERATOR_SEARCH_CX = process.env.GOOGLE_SEARCH_CX;

  // AI Proxy Endpoints
  app.post("/api/ai/suggest-titles", async (req, res) => {
    const { keyword, mode, userConfig } = req.body;
    const config = { ...userConfig };
    
    // Use operator key if user didn't provide one
    if (!config.geminiKey) config.geminiKey = OPERATOR_GEMINI_KEY;
    if (!config.openaiKey) config.openaiKey = OPERATOR_OPENAI_KEY;
    if (!config.anthropicKey) config.anthropicKey = OPERATOR_ANTHROPIC_KEY;

    const prompt = `블로그 검색 및 노출 최적화(SEO)를 고려하여 다음 키워드에 대한 매력적인 블로그 글 제목 3개를 추천해줘. JSON 형식으로 응답해줘. 
    형식: [{"title": "제목", "reason": "이유"}]
    키워드: "${keyword}"`;

    try {
      if (mode === 'gemini') {
        const genAI = new GoogleGenerativeAI(config.geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        // Extract JSON if it's wrapped in markdown
        const jsonMatch = text.match(/\[.*\]/s);
        res.json(JSON.parse(jsonMatch ? jsonMatch[0] : text));
      } else if (mode === 'chatgpt') {
        const openai = new OpenAI({ apiKey: config.openaiKey });
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        });
        const content = response.choices[0].message.content;
        const parsed = JSON.parse(content || "{}");
        res.json(Array.isArray(parsed) ? parsed : (parsed.titles || []));
      } else if (mode === 'claude') {
        const anthropic = new Anthropic({ apiKey: config.anthropicKey });
        const response = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20240620",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt + "\nJSON 형식으로만 응답해줘." }],
        });
        const text = (response.content[0] as any).text;
        res.json(JSON.parse(text));
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/generate-post", async (req, res) => {
    const { title, mode, format, userConfig, disclosure, customLink, searchResults } = req.body;
    const config = { ...userConfig };
    
    if (!config.geminiKey) config.geminiKey = OPERATOR_GEMINI_KEY;
    if (!config.openaiKey) config.openaiKey = OPERATOR_OPENAI_KEY;
    if (!config.anthropicKey) config.anthropicKey = OPERATOR_ANTHROPIC_KEY;

    let formatInstruction = "";
    if (format === 'plain') {
      formatInstruction = "어떠한 마크다운 기호나 HTML 태그도 사용하지 말고 순수 텍스트(Plain Text)로만 작성해줘.";
    } else if (format === 'html') {
      formatInstruction = "HTML 태그(<h1>, <p>, <ul>, <li> 등)를 사용하여 웹브라우저에서 바로 렌더링 가능한 형식으로 작성해줘.";
    } else {
      formatInstruction = "표준 마크다운(Markdown) 형식을 사용하여 작성해줘.";
    }

    let prompt = `다음 제목으로 블로그 글을 작성해줘. 독자의 관심을 끌 수 있는 서론, 유익한 정보가 담긴 본문, 그리고 깔끔한 결론으로 구성해줘. ${formatInstruction} 제목: "${title}"`;
    if (searchResults) prompt = `다음 검색 결과를 참고하여 할루시네이션(허위 정보) 없이 사실에 기반하여 작성해줘:\n\n${searchResults}\n\n` + prompt;
    if (disclosure) prompt = `글의 맨 처음에 다음 대가성 문구를 포함해줘: "${disclosure}"\n\n` + prompt;
    if (customLink) prompt += `\n\n글의 마지막에 다음 링크를 자연스럽게 포함하거나 추가해줘: "${customLink}"`;

    try {
      if (mode === 'gemini') {
        const genAI = new GoogleGenerativeAI(config.geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
        const result = await model.generateContent(prompt);
        res.json({ text: result.response.text() });
      } else if (mode === 'chatgpt') {
        const openai = new OpenAI({ apiKey: config.openaiKey });
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "system", content: "당신은 전문 블로그 작가입니다." }, { role: "user", content: prompt }]
        });
        res.json({ text: response.choices[0].message.content });
      } else if (mode === 'claude') {
        const anthropic = new Anthropic({ apiKey: config.anthropicKey });
        const response = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20240620",
          max_tokens: 4096,
          system: "당신은 전문 블로그 작가입니다.",
          messages: [{ role: "user", content: prompt }],
        });
        res.json({ text: (response.content[0] as any).text });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/search", async (req, res) => {
    const { query, userConfig } = req.body;
    const key = userConfig.googleSearchKey || OPERATOR_SEARCH_KEY;
    const cx = userConfig.googleSearchCx || OPERATOR_SEARCH_CX;

    if (!key || !cx) return res.json({ results: "" });

    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}`;
      const response = await axios.get(url);
      const results = response.data.items?.map((item: any) => `${item.title}: ${item.snippet}`).join('\n') || "";
      res.json({ results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/generate-thumbnail", async (req, res) => {
    const { title, userConfig } = req.body;
    const key = userConfig.openaiKey || OPERATOR_OPENAI_KEY;
    if (!key) return res.status(400).json({ error: "OpenAI Key required" });

    try {
      const openai = new OpenAI({ apiKey: key });
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: `A professional, high-quality blog thumbnail image for the topic: "${title}". Artistic, modern, and visually appealing. No text in the image.`,
        n: 1,
        size: "1024x1024",
      });
      res.json({ url: response.data[0].url });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PayPal Verification (Mock for now, but structure ready)
  app.post("/api/payments/paypal/verify", async (req, res) => {
    const { orderId } = req.body;
    // In a real app, you'd call PayPal API to verify the order status
    // and then update the user's membership in Firestore (server-side)
    res.json({ status: "COMPLETED", message: "Order verified" });
  });

  // Tistory OAuth URL
  app.get("/api/auth/tistory/url", (req, res) => {
    const { clientId, redirectUri } = req.query;
    if (!clientId || !redirectUri) return res.status(400).json({ error: "Missing params" });
    
    const url = `https://www.tistory.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code`;
    res.json({ url });
  });

  // Tistory Callback - This will be called by the popup
  app.get("/auth/tistory/callback", async (req, res) => {
    const { code, state } = req.query;
    // We send the code back to the opener so the client can handle the token exchange 
    // (or we could do it here if we had the secret, but the client has the secret in our BYOK model)
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'TISTORY_AUTH_CODE', code: '${code}' }, '*');
              window.close();
            }
          </script>
        </body>
      </html>
    `);
  });

  // Tistory Token Exchange Proxy (to avoid CORS)
  app.post("/api/auth/tistory/token", async (req, res) => {
    const { clientId, clientSecret, redirectUri, code } = req.body;
    try {
      const response = await axios.get("https://www.tistory.com/oauth/access_token", {
        params: {
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
          grant_type: "authorization_code"
        }
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(500).json({ error: error.response?.data || error.message });
    }
  });

  // Blogger OAuth URL
  app.get("/api/auth/blogger/url", (req, res) => {
    const { clientId, redirectUri } = req.query;
    if (!clientId || !redirectUri) return res.status(400).json({ error: "Missing params" });
    
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=https://www.googleapis.com/auth/blogger&access_type=offline&prompt=consent`;
    res.json({ url });
  });

  // Blogger Callback
  app.get("/auth/blogger/callback", async (req, res) => {
    const { code } = req.query;
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'BLOGGER_AUTH_CODE', code: '${code}' }, '*');
              window.close();
            }
          </script>
        </body>
      </html>
    `);
  });

  // Blogger Token Exchange Proxy
  app.post("/api/auth/blogger/token", async (req, res) => {
    const { clientId, clientSecret, redirectUri, code } = req.body;
    try {
      const response = await axios.post("https://oauth2.googleapis.com/token", {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
        grant_type: "authorization_code"
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(500).json({ error: error.response?.data || error.message });
    }
  });

  // Tistory Publish Proxy
  app.post("/api/publish/tistory", async (req, res) => {
    const { accessToken, blogName, title, content, tag } = req.body;
    try {
      const response = await axios.post("https://www.tistory.com/apis/post/write", null, {
        params: {
          access_token: accessToken,
          output: "json",
          blogName,
          title,
          content,
          visibility: 3, // 3: 발행
          tag
        }
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(500).json({ error: error.response?.data || error.message });
    }
  });

  // Blogger Publish Proxy
  app.post("/api/publish/blogger", async (req, res) => {
    const { accessToken, blogId, title, content } = req.body;
    try {
      const response = await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts`, {
        kind: "blogger#post",
        title,
        content
      }, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(500).json({ error: error.response?.data || error.message });
    }
  });

  // Blogger Get Blogs Proxy
  app.get("/api/blogger/blogs", async (req, res) => {
    const { accessToken } = req.query;
    try {
      const response = await axios.get("https://www.googleapis.com/blogger/v3/users/self/blogs", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(500).json({ error: error.response?.data || error.message });
    }
  });

  // Tistory Get Info Proxy
  app.get("/api/tistory/info", async (req, res) => {
    const { accessToken } = req.query;
    try {
      const response = await axios.get("https://www.tistory.com/apis/blog/info", {
        params: {
          access_token: accessToken,
          output: "json"
        }
      });
      res.json(response.data);
    } catch (error: any) {
      res.status(500).json({ error: error.response?.data || error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
