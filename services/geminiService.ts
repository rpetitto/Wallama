
import { GoogleGenAI, Type } from "@google/genai";

export const refinePostContent = async (prompt: string, type: 'text' | 'creative'): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: type === 'text' 
        ? `Refine this educational post to be clear, engaging, and professional for a classroom setting: "${prompt}"`
        : `Generate a creative response or thought about this topic for a class discussion board: "${prompt}"`,
      config: {
        temperature: 0.7,
      }
    });
    return response.text || "Sorry, I couldn't refine that.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "AI Refinement currently unavailable.";
  }
};

export const suggestWallTopics = async (subject: string): Promise<string[]> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Provide 5 engaging discussion topics or prompt titles for a collaborative classroom wall about ${subject}.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });
    return JSON.parse(response.text || "[]");
  } catch (error) {
    return ["General Discussion", "Reflections", "Questions", "Resources"];
  }
};

export const checkContentSafety = async (text: string, imageData?: string): Promise<{ isSafe: boolean; reason?: string }> => {
  // If no text and no image, it's safe (e.g., just a video blob that we aren't checking)
  if (!text.trim() && !imageData) return { isSafe: true };

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const parts: any[] = [];
    
    if (imageData && imageData.startsWith('data:')) {
      // Basic check to ensure we don't send massive images that will definitely fail before hitting the model
      // Gemini 1.5 Flash has a limit, but usually handles reasonable base64. 
      // If it's too big, the try/catch will handle it.
      const base64Data = imageData.split(',')[1];
      const mimeType = imageData.split(';')[0].split(':')[1];
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
    }

    const systemPrompt = `You are a moderator for a K-12 school app. Analyze content for safety.
    Return {"isSafe": false, "reason": "..."} for: Profanity, Hate Speech, Nudity, Violence, or Illegal acts.
    Otherwise return {"isSafe": true}.`;

    parts.push({ text: `Analyze this for school safety: ${text}` });

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts },
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isSafe: { type: Type.BOOLEAN },
            reason: { type: Type.STRING }
          },
          required: ["isSafe"]
        }
      }
    });

    const result = JSON.parse(response.text || '{"isSafe":false}');
    return {
      isSafe: result.isSafe === true,
      reason: result.isSafe ? undefined : (result.reason || "Content flagged as inappropriate.")
    };
  } catch (error) {
    console.warn("Safety Check Failed (allowing content):", error);
    // Fail OPEN: If the safety check fails (e.g. file too large, API error), allow the content.
    // This prevents blocking users when the AI service is having trouble or the file is large (like a video).
    return { isSafe: true }; 
  }
};
