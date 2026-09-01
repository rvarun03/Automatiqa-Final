import { GoogleGenAI, Type } from "@google/genai";
import { RecordedFlow, AutomationTool, ProgrammingLanguage } from '../types';

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const FALLBACK_MODELS = ['gemini-3.7-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

async function withRetry<T>(fn: (modelName: string) => Promise<T>, maxRetriesPerModel = 2): Promise<T> {
  let lastError: any = null;
  for (const modelName of FALLBACK_MODELS) {
    let delay = 1000;
    for (let attempt = 0; attempt < maxRetriesPerModel; attempt++) {
      try {
        return await fn(modelName);
      } catch (err: any) {
        lastError = err;
        if (attempt < maxRetriesPerModel - 1) {
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
        }
      }
    }
  }
  throw lastError;
}

export interface GeneratedProject {
  files: {
    path: string;
    content: string;
  }[];
  explanation: string;
}

export const generateAutomationScript = async (
  flow: RecordedFlow,
  tool: AutomationTool,
  language: ProgrammingLanguage
): Promise<GeneratedProject> => {
  const prompt = `
    You are an expert automation architect. Convert the following recorded test flow into a complete, production-ready automation project using the Page Object Model (POM) pattern.
    
    Target Framework: ${tool}
    Target Language: ${language}
    
    Flow Name: ${flow.name}
    Platform: ${flow.platform}
    ${flow.description ? `Description: ${flow.description}` : ''}
    ${flow.refineInstructions ? `Refine Instructions / Custom Guidelines: ${flow.refineInstructions}` : ''}
    
    Complete Recorded Steps (Universal Format):
    ${JSON.stringify(flow.steps, null, 2)}
    
    CRITICAL MANDATORY REQUIREMENTS:
    1. The generated script and page objects MUST contain ALL recorded steps.
    2. Include all user interactions and all pages from the complete recording.
    3. Do NOT skip, remove, omit, or condense any recorded step. Every single user interaction recorded in the flow must be included in the generated page objects and test script in the exact sequential order.
    4. The generated script must reproduce the complete user journey during playback across all pages.
    5. Generate a full project structure as a JSON array of files.
    6. Use the Page Object Model (POM) pattern strictly.
    7. Group recorded steps by the "screen" / page field. Generate Page classes for all unique screens/pages encountered in the steps.
    8. Each page should extend a BasePage that contains common methods (e.g., click, fill, waitForElement, navigate).
    9. The project structure MUST include:
       - package.json: With all necessary dependencies (playwright/appium/selenium, dotenv, etc.) and scripts (test, report).
       - playwright.config.ts (or equivalent config for other tools): Full configuration with base URL, timeouts, and reporters.
       - .env: Template for environment variables.
       - pages/BasePage.ts: Abstract base class.
       - pages/[ScreenName]Page.ts: Specific page classes for every page visited with locators as properties and actions as methods covering every step on that page.
       - tests/[FlowName].spec.ts: Complete end-to-end test script chaining every single page action in chronological order to execute the full user journey.
       - utils/envUtils.ts: Utility to manage environment variables.
       - data/testData.json (if data-driven testing applies): Structured test data inputs.
    10. For Playwright, use best practices: getByRole, getByText, getByTestId, getByLabel, getByPlaceholder, etc.
    11. Ensure the code is clean, well-commented, and follows industry standards for QA automation.
    12. The folder structure should be logical (e.g., pages/, tests/, utils/, data/).
    
    Return the response in JSON format:
    {
      "files": [
        { "path": "package.json", "content": "..." },
        { "path": "playwright.config.ts", "content": "..." },
        { "path": "pages/BasePage.ts", "content": "..." },
        { "path": "pages/HomePage.ts", "content": "..." },
        { "path": "tests/smoke-test.spec.ts", "content": "..." },
        { "path": "utils/envUtils.ts", "content": "..." }
      ],
      "explanation": "Brief summary of the architecture and patterns used"
    }
  `;

  try {
    const response = await withRetry((model) => ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            files: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  path: { type: Type.STRING },
                  content: { type: Type.STRING }
                },
                required: ["path", "content"]
              }
            },
            explanation: { type: Type.STRING }
          },
          required: ["files", "explanation"]
        }
      }
    }));

    const result = JSON.parse(response.text || '{}');
    return {
      files: result.files || [],
      explanation: result.explanation || 'No explanation provided'
    };
  } catch (error) {
    console.error("Project Generation Error:", error);
    return {
      files: [{ path: "error.txt", content: `Error generating project: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      explanation: "An error occurred during the AI generation process. Please retry in a few moments."
    };
  }
};

export const suggestLocatorHealing = async (
  step: any,
  domContext?: string
): Promise<{ suggestedLocator: string; reasoning: string }> => {
  const prompt = `
    Analyze this failing automation step and suggest a more stable locator.
    
    Step: ${JSON.stringify(step)}
    ${domContext ? `DOM Context: ${domContext}` : ''}
    
    Focus on stability and avoiding dynamic attributes.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestedLocator: { type: Type.STRING },
            reasoning: { type: Type.STRING }
          },
          required: ["suggestedLocator", "reasoning"]
        }
      }
    });

    return JSON.parse(response.text || '{}');
  } catch (error) {
    return { suggestedLocator: '', reasoning: 'AI analysis failed' };
  }
};
