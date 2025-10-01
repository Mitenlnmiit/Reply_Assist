// Options page script for Chat Refinement Assistant
class OptionsManager {
  constructor() {
    this.init();
  }

  init() {
    // Load saved settings
    this.loadSettings();
    
    // Add event listeners
    document.getElementById('saveSettings').addEventListener('click', () => {
      this.saveSettings();
    });

    document.getElementById('testConnection').addEventListener('click', () => {
      this.testConnection();
    });

    document.getElementById('clearSettings').addEventListener('click', () => {
      this.clearSettings();
    });

    // Auto-save on input change
    document.getElementById('apiKey').addEventListener('input', () => {
      this.updateApiKeyStatus();
    });

    // Reset system prompt to default
    const resetBtn = document.getElementById('resetSystemPrompt');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetSystemPromptToDefault());
    }

    // Save only the system prompt
    const savePromptBtn = document.getElementById('saveSystemPrompt');
    if (savePromptBtn) {
      savePromptBtn.addEventListener('click', () => this.saveSystemPromptOnly());
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['geminiApiKey', 'systemPrompt']);
      const apiKey = result.geminiApiKey || '';
      const systemPrompt = typeof result.systemPrompt === 'string' ? result.systemPrompt : this.getDefaultSystemPrompt();
      
      document.getElementById('apiKey').value = apiKey;
      const systemPromptEl = document.getElementById('systemPrompt');
      if (systemPromptEl) systemPromptEl.value = systemPrompt;
      this.updateApiKeyStatus();
    } catch (error) {
      this.showAlert('Error loading settings: ' + error.message, 'error');
    }
  }

  async saveSettings() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const systemPromptEl = document.getElementById('systemPrompt');
    const systemPrompt = systemPromptEl ? systemPromptEl.value : '';
    
    if (!apiKey) {
      this.showAlert('Please enter your Gemini API key', 'warning');
      return;
    }

    try {
      const payload = { geminiApiKey: apiKey };
      if (typeof systemPrompt === 'string' && systemPrompt.trim().length > 0) {
        payload.systemPrompt = systemPrompt;
      } else {
        // If user clears it, store nothing; background will fall back to default
        payload.systemPrompt = '';
      }
      await chrome.storage.sync.set(payload);
      this.showAlert('Settings saved successfully!', 'success');
      this.updateApiKeyStatus();
    } catch (error) {
      this.showAlert('Error saving settings: ' + error.message, 'error');
    }
  }

  async saveSystemPromptOnly() {
    try {
      const systemPromptEl = document.getElementById('systemPrompt');
      const systemPrompt = systemPromptEl ? systemPromptEl.value : '';
      const payload = {};
      if (typeof systemPrompt === 'string' && systemPrompt.trim().length > 0) {
        payload.systemPrompt = systemPrompt;
      } else {
        payload.systemPrompt = '';
      }
      await chrome.storage.sync.set(payload);
      this.showAlert('System prompt saved successfully!', 'success');
    } catch (error) {
      this.showAlert('Error saving system prompt: ' + error.message, 'error');
    }
  }

  resetSystemPromptToDefault() {
    const systemPromptEl = document.getElementById('systemPrompt');
    if (systemPromptEl) {
      systemPromptEl.value = this.getDefaultSystemPrompt();
      this.showAlert('System prompt reset to default. Click Save Settings to apply.', 'info');
    }
  }

  getDefaultSystemPrompt() {
    return `<System Prompt>
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
  }

  async testConnection() {
    const apiKey = document.getElementById('apiKey').value.trim();
    
    if (!apiKey) {
      this.showAlert('Please enter your API key first', 'warning');
      return;
    }

    const testButton = document.getElementById('testConnection');
    const originalText = testButton.textContent;
    
    testButton.disabled = true;
    testButton.textContent = 'Testing...';
    this.updateApiKeyStatus('testing');

    try {
      // Use background script to test the connection (avoids CORS issues)
      const response = await chrome.runtime.sendMessage({
        action: 'testApiConnection',
        apiKey: apiKey
      });

      if (response && response.success) {
        this.showAlert('Connection test successful! Your API key is working correctly.', 'success');
        this.updateApiKeyStatus('success');
      } else {
        throw new Error(response?.error || 'Unknown error occurred');
      }
      
    } catch (error) {
      console.error('Connection test failed:', error);
      this.showAlert('Connection test failed: ' + error.message, 'error');
      this.updateApiKeyStatus('error');
    } finally {
      testButton.disabled = false;
      testButton.textContent = originalText;
    }
  }

  async clearSettings() {
    if (confirm('Are you sure you want to clear all settings? This will remove your API key.')) {
      try {
        await chrome.storage.sync.clear();
        document.getElementById('apiKey').value = '';
        this.updateApiKeyStatus();
        this.showAlert('Settings cleared successfully', 'success');
      } catch (error) {
        this.showAlert('Error clearing settings: ' + error.message, 'error');
      }
    }
  }

  updateApiKeyStatus(status = null) {
    const apiKey = document.getElementById('apiKey').value.trim();
    const statusIndicator = document.getElementById('apiKeyStatus');
    
    if (status === 'testing') {
      statusIndicator.className = 'status-indicator warning';
      statusIndicator.title = 'Testing connection...';
    } else if (status === 'success') {
      statusIndicator.className = 'status-indicator success';
      statusIndicator.title = 'API key is valid';
    } else if (status === 'error') {
      statusIndicator.className = 'status-indicator error';
      statusIndicator.title = 'API key is invalid';
    } else if (apiKey) {
      statusIndicator.className = 'status-indicator warning';
      statusIndicator.title = 'API key entered (not tested)';
    } else {
      statusIndicator.className = 'status-indicator error';
      statusIndicator.title = 'No API key';
    }
  }

  showAlert(message, type = 'info') {
    // Remove existing alerts
    const alertsContainer = document.getElementById('alerts');
    alertsContainer.innerHTML = '';

    // Create new alert
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    
    alertsContainer.appendChild(alert);

    // Auto-remove after 5 seconds for success messages
    if (type === 'success') {
      setTimeout(() => {
        if (alert.parentNode) {
          alert.remove();
        }
      }, 5000);
    }
  }
}

// Initialize options page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new OptionsManager();
});
