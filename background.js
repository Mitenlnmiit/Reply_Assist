// Background script for Chat Refinement Assistant
class ChatRefinementBackground {
  constructor() {
    this.init();
  }

  // ---------- Debug helpers ----------
  debugEnabled() {
    return true; // toggle if needed
  }

  dbg(...args) {
    if (!this.debugEnabled()) return;
    try { console.log('[ChatRefinement:BG]', ...args); } catch (_) {}
  }

  init() {
    // Check if Chrome runtime is available
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      console.error('Chrome runtime not available in background script');
      return;
    }

    // Listen for messages from content script and options page
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      try {
        if (request.action === 'refineText') {
          this.handleRefineText(request.data, sender.tab.id);
          return true; // Keep message channel open for async response
        } else if (request.action === 'testApiConnection') {
          this.handleTestApiConnection(request.apiKey, sendResponse);
          return true; // Keep message channel open for async response
        }
      } catch (error) {
        console.error('Error handling message in background:', error);
        if (sender.tab && sender.tab.id) {
          this.sendErrorToContent(sender.tab.id, 'Background script error: ' + error.message);
        }
      }
    });

    // Listen for commands
    chrome.commands.onCommand.addListener((command) => {
      try {
        this.handleCommand(command);
      } catch (error) {
        console.error('Error handling command:', error);
      }
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
      
      // Log the complete prompt being sent to Gemini
      console.log('=== PROMPT SENT TO GEMINI ===');
      console.log(prompt.contents[0].parts[0].text);
      console.log('=============================');
      
      // Call Gemini API
      const refinedText = await this.callGeminiAPI(apiKey, prompt);
      this.dbg('response length', (refinedText || '').length, 'preview:', (refinedText || '').slice(0, 300) + (refinedText && refinedText.length > 300 ? '…' : ''));
      
      // Send response back to content script
      if (tabId) {
        try {
          chrome.tabs.sendMessage(tabId, {
            action: 'refinementComplete',
            data: {
              refinedText: refinedText,
              action: data.action || 'preview' // Use the action from the request
            }
          });
          this.dbg('sent refinementComplete back to tab', tabId);
        } catch (error) {
          console.error('Error sending success message to content script:', error);
        }
      } else {
        console.error('No tab ID available for sending success message');
      }

    } catch (error) {
      console.error('Error in background script:', error);
      this.sendErrorToContent(tabId, error.message);
    }
  }

  async handleTestApiConnection(apiKey, sendResponse) {
    try {
      if (!apiKey) {
        sendResponse({ success: false, error: 'No API key provided' });
        return;
      }

      // Test with a simple API call
      const testPrompt = {
        contents: [{
          parts: [{
            text: 'Hello, this is a test message. Please respond with "Test successful" if you can read this.'
          }]
        }]
      };

      const response = await this.callGeminiAPI(apiKey, testPrompt);
      
      if (response && response.trim()) {
        this.dbg('API test successful');
        sendResponse({ success: true, message: 'API connection test successful' });
      } else {
        sendResponse({ success: false, error: 'No response from API' });
      }
      
    } catch (error) {
      this.dbg('API test failed:', error.message);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleCommand(command) {
    this.dbg('Command received:', command);
    
    if (command === 'refine-preview') {
      this.dbg('Handling refine-preview command');
      // Get active tab and send message to content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        this.dbg('Sending refinePreview message to tab:', tab.id);
        chrome.tabs.sendMessage(tab.id, { action: 'refinePreview' });
      } else {
        this.dbg('No active tab found');
      }
    } else if (command === 'refine-replace') {
      this.dbg('Handling refine-replace command');
      // Get active tab and send message to content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        this.dbg('Sending refineReplace message to tab:', tab.id);
        chrome.tabs.sendMessage(tab.id, { action: 'refineReplace' });
      } else {
        this.dbg('No active tab found');
      }
    } else {
      this.dbg('Unknown command:', command);
    }
  }

  buildPrompt(draftText, conversationHistory) {
    const systemPrompt = `<System Prompt>
You are a writing refinement assistant. 
Your only task is to take user-written text and refine it so it becomes:
- Preserving the original intent, meaning, and personal voice
- Matching the tone of the surrounding conversation (given as context)

You must never add new ideas, facts, or content that wasn't in the user text.

<Rules>
1. Preserve the intent and emotional nuance of the user text.
2. Refer the message tone and context from given messages and include it in answer.
3. Output only the refined text. Do not include explanations or notes.
</Rules>
</System Prompt>

<User Input>`;

    let conversationText = '';
    if (conversationHistory && conversationHistory.length > 0) {
      conversationText = 'Conversation (last 1K–2K tokens):\n';
      conversationHistory.forEach(msg => {
        conversationText += `[${msg.sender}]: ${msg.text}\n`;
      });
    }

    const userPrompt = `${conversationText}\n<My Draft>${draftText}</My Draft>`;

    return {
      contents: [{
        parts: [{
          text: `${systemPrompt}\n\n${userPrompt}`
        }]
      }]
    };
  }

  async callGeminiAPI(apiKey, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(prompt)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      this.dbg('API error', response.status, response.statusText, errorData);
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
    if (!tabId) {
      console.error('No tab ID available for sending error message');
      return;
    }
    
    try {
      chrome.tabs.sendMessage(tabId, {
        action: 'refinementError',
        error: errorMessage
      });
    } catch (error) {
      console.error('Error sending message to content script:', error);
    }
  }
}

// Initialize the background script
new ChatRefinementBackground();
