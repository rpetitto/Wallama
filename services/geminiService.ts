
import { GoogleGenAI, Type } from "@google/genai";

export const refinePostContent = async (prompt: string, type: 'text' | 'creative'): Promise<string> => {
  try {
    // Creating a new instance right before making an API call ensures it always uses the most up-to-date API key.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: type === 'text' 
        ? `Refine this educational post to be clear, engaging, and professional for a classroom setting: "${prompt}"`
        : `Generate a creative response or thought about this topic for a class discussion board: "${prompt}"`,
      config: {
        // Removed maxOutputTokens to follow recommendation and prevent potential response blocking.
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
    // Creating a new instance right before making an API call ensures it always uses the most up-to-date API key.
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
