
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
  // If no content to check, assume safe (e.g. empty or just a video blob we can't check easily yet)
  if ((!text || text.trim().length === 0) && !imageData) return { isSafe: true };

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const parts: any[] = [];
    
    if (imageData) {
        if (imageData.startsWith('data:')) {
            const match = imageData.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                parts.push({
                    inlineData: {
                        mimeType: match[1], // e.g. image/png
                        data: match[2]      // base64 string
                    }
                });
            }
        }
    }

    const systemPrompt = `You are a strict content moderator for a K-12 educational app.
    Your task is to allow ONLY content that is safe, appropriate, and non-offensive for children and teenagers.
    
    STRICTLY BLOCK (isSafe: false) any content containing:
    - Profanity, obscenity, or vulgar language (including masked words like f*ck).
    - Sexual content, nudity, innuendo, or grooming behavior.
    - Hate speech, discrimination, slurs, or bullying.
    - Violence, gore, weapons, death threats, or self-harm.
    - Illegal acts, drug use/references, or alcohol.
    - Inappropriate or suggestive slang.

    If the content is safe and educational or casual friendly conversation, return isSafe: true.
    
    Respond with JSON.`;

    const userPrompt = text ? `Analyze this content for safety: "${text}"` : `Analyze this image.`;
    parts.push({ text: userPrompt });

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
            reason: { type: Type.STRING, description: "Reason if unsafe." }
          },
          required: ["isSafe"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    
    // Strict Boolean Check
    if (typeof result.isSafe === 'boolean') {
        return {
          isSafe: result.isSafe,
          reason: result.isSafe ? undefined : (result.reason || "Content flagged as inappropriate.")
        };
    }

    // If response is malformed, fail closed
    return { isSafe: false, reason: "Safety check validation error." };

  } catch (error) {
    console.error("Safety Check Error:", error);
    // FAIL CLOSED: Block content if API fails
    return { isSafe: false, reason: "Content safety verification unavailable. Please try again." }; 
  }
};
