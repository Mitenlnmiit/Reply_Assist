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
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['geminiApiKey']);
      const apiKey = result.geminiApiKey || '';
      
      document.getElementById('apiKey').value = apiKey;
      this.updateApiKeyStatus();
    } catch (error) {
      this.showAlert('Error loading settings: ' + error.message, 'error');
    }
  }

  async saveSettings() {
    const apiKey = document.getElementById('apiKey').value.trim();
    
    if (!apiKey) {
      this.showAlert('Please enter your Gemini API key', 'warning');
      return;
    }

    try {
      await chrome.storage.sync.set({ geminiApiKey: apiKey });
      this.showAlert('Settings saved successfully!', 'success');
      this.updateApiKeyStatus();
    } catch (error) {
      this.showAlert('Error saving settings: ' + error.message, 'error');
    }
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
      // Test with a simple API call
      const testPrompt = {
        contents: [{
          parts: [{
            text: 'Hello, this is a test message. Please respond with "Test successful" if you can read this.'
          }]
        }]
      };

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPrompt)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API request failed: ${response.status} ${response.statusText}. ${errorData.error?.message || ''}`);
      }

      const data = await response.json();
      
      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('No response from API');
      }

      this.showAlert('Connection test successful! Your API key is working correctly.', 'success');
      this.updateApiKeyStatus('success');
      
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
