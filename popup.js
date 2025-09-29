// Popup script for Reply Assist
class PopupManager {
  constructor() {
    this.init();
  }

  init() {
    // Check API key status on load
    this.checkApiKeyStatus();
    
    // Add event listeners
    document.getElementById('open-options').addEventListener('click', () => {
      this.openOptionsPage();
    });

    document.getElementById('test-connection').addEventListener('click', () => {
      this.testConnection();
    });
  }

  async checkApiKeyStatus() {
    try {
      const result = await chrome.storage.sync.get(['geminiApiKey']);
      const apiKey = result.geminiApiKey;

      if (!apiKey) {
        this.updateStatus('warning', '⚠️', 'API key not configured', 'Please set your Gemini API key to start using the extension');
        document.getElementById('test-connection').disabled = true;
      } else {
        this.updateStatus('success', '✅', 'Ready to refine messages', 'API key configured. Use Ctrl+Y or Ctrl+U in any text field');
        document.getElementById('test-connection').disabled = false;
      }
    } catch (error) {
      this.updateStatus('error', '❌', 'Error checking status', error.message);
    }
  }

  updateStatus(type, icon, text, detail) {
    const statusIcon = document.getElementById('status-icon');
    const statusText = document.getElementById('status-text');
    const statusDetail = document.getElementById('status-detail');

    statusIcon.className = `status-icon ${type}`;
    statusIcon.innerHTML = `<span>${icon}</span>`;
    statusText.textContent = text;
    statusDetail.textContent = detail;
  }

  openOptionsPage() {
    chrome.runtime.openOptionsPage();
  }

  async testConnection() {
    const testButton = document.getElementById('test-connection');
    const originalText = testButton.textContent;
    
    testButton.disabled = true;
    testButton.textContent = 'Testing...';
    this.updateStatus('warning', '🔄', 'Testing connection...', 'Please wait');

    // Check rate limit status first
    try {
      const rateLimitStatus = await chrome.runtime.sendMessage({ action: 'getRateLimitStatus' });
      console.log('Rate limit status:', rateLimitStatus);
      
      if (rateLimitStatus.isRateLimited) {
        this.updateStatus('error', '⏰', 'Rate limited', `Please wait ${Math.ceil(rateLimitStatus.windowResetTime / 1000)} seconds`);
        testButton.disabled = false;
        testButton.textContent = originalText;
        return;
      }
    } catch (error) {
      console.log('Could not check rate limit status:', error);
    }

    try {
      const result = await chrome.storage.sync.get(['geminiApiKey']);
      const apiKey = result.geminiApiKey;

      if (!apiKey) {
        throw new Error('No API key configured');
      }

      // Test with a simple API call
      const testPrompt = {
        contents: [{
          parts: [{
            text: 'Hello, this is a test message. Please respond with "Test successful" if you can read this.'
          }]
        }]
      };

      // Log the test request details
      console.log('=== GEMINI API TEST REQUEST ===');
      console.log('URL:', `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey.substring(0, 10)}...`);
      console.log('Request Body (Test Prompt):', JSON.stringify(testPrompt, null, 2));
      console.log('Test Prompt Text:', testPrompt.contents[0].parts[0].text);
      console.log('==============================');

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPrompt)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.log('=== GEMINI API TEST ERROR ===');
        console.log('Status:', response.status, response.statusText);
        console.log('Error Data:', JSON.stringify(errorData, null, 2));
        console.log('==============================');
        throw new Error(`API request failed: ${response.status} ${response.statusText}. ${errorData.error?.message || ''}`);
      }

      const data = await response.json();
      
      // Log the test response details
      console.log('=== GEMINI API TEST RESPONSE ===');
      console.log('Complete Response:', JSON.stringify(data, null, 2));
      console.log('Candidates Count:', Array.isArray(data.candidates) ? data.candidates.length : 0);
      if (data.candidates && data.candidates.length > 0) {
        console.log('First Candidate:', JSON.stringify(data.candidates[0], null, 2));
        if (data.candidates[0].content && data.candidates[0].content.parts) {
          console.log('Test Response Text:', data.candidates[0].content.parts[0].text);
        }
      }
      console.log('================================');
      
      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('No response from API');
      }

      this.updateStatus('success', '✅', 'Connection successful', 'API key is working correctly');
      
    } catch (error) {
      console.error('Connection test failed:', error);
      this.updateStatus('error', '❌', 'Connection failed', error.message);
    } finally {
      testButton.disabled = false;
      testButton.textContent = originalText;
    }
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
