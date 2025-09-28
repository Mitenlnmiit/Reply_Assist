// Background script for Chat Refinement Assistant
class ChatRefinementBackground {
  constructor() {
    this.requestCount = 0;
    this.lastRequestTime = 0;
    this.rateLimitWindow = 60000; // 1 minute window
    this.maxRequestsPerMinute = 15; // Conservative limit
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
        } else if (request.action === 'getRateLimitStatus') {
          const status = this.getRateLimitStatus();
          sendResponse(status);
          return true;
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
    console.log('[BACKGROUND] handleRefineText called with data:', data);
    console.log('[BACKGROUND] Tab ID:', tabId);
    
    try {
      // Get API key from storage
      const result = await chrome.storage.sync.get(['geminiApiKey']);
      const apiKey = result.geminiApiKey;

      if (!apiKey) {
        console.log('[BACKGROUND] No API key found');
        this.sendErrorToContent(tabId, 'API key not configured. Please set your Gemini API key in extension options.');
        return;
      }

      console.log('[BACKGROUND] API key found, building prompt');
      // Build the prompt
      const prompt = this.buildPrompt(data.draftText, data.conversationHistory, data.customInstruction);
      
      // Log the complete prompt being sent to Gemini
      console.log('=== PROMPT SENT TO GEMINI ===');
      console.log(prompt.contents[0].parts[0].text);
      console.log('=============================');
      
      console.log('[BACKGROUND] Calling Gemini API');
      // Call Gemini API
      const refinedText = await this.callGeminiAPI(apiKey, prompt);
      console.log('[BACKGROUND] Gemini API response received, length:', (refinedText || '').length);
      this.dbg('response length', (refinedText || '').length, 'preview:', (refinedText || '').slice(0, 300) + (refinedText && refinedText.length > 300 ? '…' : ''));
      
      // Send response back to content script
      if (tabId) {
        try {
          console.log('[BACKGROUND] Sending refinementComplete message to tab:', tabId);
          chrome.tabs.sendMessage(tabId, {
            action: 'refinementComplete',
            data: {
              refinedText: refinedText,
              action: data.action || 'preview' // Use the action from the request
            }
          });
          console.log('[BACKGROUND] Message sent successfully');
          this.dbg('sent refinementComplete back to tab', tabId);
        } catch (error) {
          console.error('[BACKGROUND] Error sending success message to content script:', error);
        }
      } else {
        console.error('[BACKGROUND] No tab ID available for sending success message');
      }

    } catch (error) {
      console.error('[BACKGROUND] Error in background script:', error);
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
      this.dbg('Handling custom commands (refine-preview)');
      // Get active tab and send message to content script for custom commands
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        this.dbg('Sending customCommands message to tab:', tab.id);
        chrome.tabs.sendMessage(tab.id, { action: 'customCommands' });
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

  buildPrompt(draftText, conversationHistory, customInstruction = '') {
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

    // Add custom instruction section if provided
    let customInstructionSection = '';
    if (customInstruction && customInstruction.trim()) {
      customInstructionSection = `\n<Custom Instruction>\n${customInstruction.trim()}\n</Custom Instruction>`;
    }

    const userPrompt = `${conversationText}\n<My Draft>${draftText}</My Draft>${customInstructionSection}`;

    return {
      contents: [{
        parts: [{
          text: `${systemPrompt}\n\n${userPrompt}`
        }]
      }]
    };
  }

  async callGeminiAPI(apiKey, prompt) {
    // Check rate limiting
    const now = Date.now();
    if (now - this.lastRequestTime > this.rateLimitWindow) {
      this.requestCount = 0;
      this.lastRequestTime = now;
    }
    
    if (this.requestCount >= this.maxRequestsPerMinute) {
      const waitTime = this.rateLimitWindow - (now - this.lastRequestTime);
      throw new Error(`Rate limit reached. Please wait ${Math.ceil(waitTime / 1000)} seconds before trying again.`);
    }
    
    this.requestCount++;
    this.dbg('Rate limiting check', { requestCount: this.requestCount, timeSinceLastWindow: now - this.lastRequestTime });
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
    
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
      
      // Check for rate limiting
      if (response.status === 429) {
        throw new Error(`Rate limit exceeded. Please wait before making more requests. Status: ${response.status}`);
      } else if (response.status === 503) {
        throw new Error(`Service temporarily unavailable. This might be due to high traffic or rate limiting. Status: ${response.status}`);
      } else if (response.status === 403) {
        throw new Error(`Access forbidden. Check your API key and permissions. Status: ${response.status}`);
      }
      
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

  // Get current rate limiting status
  getRateLimitStatus() {
    const now = Date.now();
    const timeSinceLastWindow = now - this.lastRequestTime;
    const requestsRemaining = Math.max(0, this.maxRequestsPerMinute - this.requestCount);
    const windowResetTime = this.rateLimitWindow - timeSinceLastWindow;
    
    return {
      requestCount: this.requestCount,
      maxRequests: this.maxRequestsPerMinute,
      requestsRemaining: requestsRemaining,
      windowResetTime: Math.max(0, windowResetTime),
      isRateLimited: this.requestCount >= this.maxRequestsPerMinute
    };
  }
}

// Initialize the background script
new ChatRefinementBackground();
