// Background script for Chat Refinement Assistant
class ChatRefinementBackground {
  constructor() {
    this.init();
  }

  init() {
    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'refineText') {
        this.handleRefineText(request.data, sender.tab.id);
        return true; // Keep message channel open for async response
      }
    });

    // Listen for commands
    chrome.commands.onCommand.addListener((command) => {
      this.handleCommand(command);
    });
  }

  async handleRefineText(data, tabId) {
    try {
      // Get API key from storage
      const result = await chrome.storage.sync.get(['geminiApiKey']);
      const apiKey = result.geminiApiKey;

      if (!apiKey) {
        this.sendErrorToContent(tabId, 'API key not configured. Please set your Gemini API key in extension options.');
        return;
      }

      // Build the prompt
      const prompt = this.buildPrompt(data.draftText, data.conversationHistory);
      
      // Call Gemini API
      const refinedText = await this.callGeminiAPI(apiKey, prompt);
      
      // Send response back to content script
      chrome.tabs.sendMessage(tabId, {
        action: 'refinementComplete',
        data: {
          refinedText: refinedText,
          action: 'preview' // Default to preview mode
        }
      });

    } catch (error) {
      console.error('Error in background script:', error);
      this.sendErrorToContent(tabId, error.message);
    }
  }

  async handleCommand(command) {
    if (command === 'refine-preview') {
      // Get active tab and send message to content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'refinePreview' });
      }
    } else if (command === 'refine-replace') {
      // Get active tab and send message to content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'refineReplace' });
      }
    }
  }

  buildPrompt(draftText, conversationHistory) {
    const systemPrompt = `You are a writing assistant that refines the user's draft reply in ongoing conversations. Keep it natural, context-aware, and concise. Maintain tone consistency with prior messages. Return only the refined text without any explanations or additional formatting.`;

    let conversationText = '';
    if (conversationHistory && conversationHistory.length > 0) {
      conversationText = 'Conversation (last 1K–2K tokens):\n';
      conversationHistory.forEach(msg => {
        conversationText += `[${msg.sender}]: ${msg.text}\n`;
      });
    }

    const userPrompt = `${conversationText}\nMy draft reply: ${draftText}`;

    return {
      contents: [{
        parts: [{
          text: `${systemPrompt}\n\n${userPrompt}`
        }]
      }]
    };
  }

  async callGeminiAPI(apiKey, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(prompt)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API request failed: ${response.status} ${response.statusText}. ${errorData.error?.message || ''}`);
    }

    const data = await response.json();
    
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No response from Gemini API');
    }

    const candidate = data.candidates[0];
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      throw new Error('Invalid response format from Gemini API');
    }

    return candidate.content.parts[0].text.trim();
  }

  sendErrorToContent(tabId, errorMessage) {
    chrome.tabs.sendMessage(tabId, {
      action: 'refinementError',
      error: errorMessage
    });
  }
}

// Initialize the background script
new ChatRefinementBackground();
