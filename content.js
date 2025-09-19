// Content script for Chat Refinement Assistant
class ChatRefinementExtension {
  constructor() {
    this.isProcessing = false;
    this.refinedText = '';
    this.originalText = '';
    this.currentTextArea = null;
    this.popup = null;
    this.init();
  }

  // ---------- Debug helpers ----------
  debugEnabled() {
    return true; // toggle here if needed
  }

  dbg(...args) {
    if (!this.debugEnabled()) return;
    try { console.log('[ChatRefinement]', ...args); } catch (_) {}
  }

  dbgGroup(title) {
    if (!this.debugEnabled()) return;
    try { console.groupCollapsed('[ChatRefinement]', title); } catch (_) {}
  }

  dbgGroupEnd() {
    if (!this.debugEnabled()) return;
    try { console.groupEnd(); } catch (_) {}
  }

  truncate(str, max = 500) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  init() {
    // Check if Chrome runtime is available
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      console.error('Chrome runtime not available');
      return;
    }

    // Listen for keyboard shortcuts
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'refinementComplete') {
        this.handleRefinementComplete(request.data);
      } else if (request.action === 'refinementError') {
        this.handleRefinementError(request.error);
      }
    });
  }

  handleKeyDown(event) {
    // Check for Ctrl+Shift+P (preview) or Ctrl+Shift+L (replace)
    this.dbg('keydown', { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey, key: event.key });
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey) {
      if (event.key === 'p' || event.key === 'P') {
        event.preventDefault();
        this.dbg('shortcut detected: preview (Ctrl+Shift+P)');
        this.handleRefinePreview();
      } else if (event.key === 'l' || event.key === 'L') {
        event.preventDefault();
        this.dbg('shortcut detected: replace (Ctrl+Shift+L)');
        this.handleRefineReplace();
      }
    }
  }

  async handleRefinePreview() {
    if (this.isProcessing) return;
    
    const textArea = this.getActiveTextArea();
    this.dbg('preview: active text area found:', !!textArea);
    if (!textArea) {
      this.showNotification('No text area found. Click in a text input field first.', 'error');
      return;
    }

    const draftText = this.getTextFromElement(textArea);
    this.dbg('preview: draft length:', draftText.length, 'preview:', this.truncate(draftText, 200));
    if (!draftText.trim()) {
      this.showNotification('No draft text found. Type something first.', 'error');
      return;
    }

    this.currentTextArea = textArea;
    this.originalText = draftText;
    this.isProcessing = true;

    try {
      // Get conversation history
      const conversationHistory = this.extractConversationHistory();
      this.dbg('preview: conversation items:', conversationHistory.length);
      this.dbg('preview: conversation sample:', conversationHistory.slice(-3));
      
      // Send to background script for API call
      try {
        chrome.runtime.sendMessage({
          action: 'refineText',
          data: {
            draftText: draftText,
            conversationHistory: conversationHistory,
            action: 'preview' // Preview mode
          }
        });
        this.dbg('preview: message sent to background');
      } catch (error) {
        console.error('Error sending message to background:', error);
        this.showNotification('Extension communication error. Please reload the page.', 'error');
        this.isProcessing = false;
      }

      this.showNotification('Refining your message...', 'info');
    } catch (error) {
      console.error('Error in preview:', error);
      this.showNotification('Error: ' + error.message, 'error');
      this.isProcessing = false;
    }
  }

  async handleRefineReplace() {
    if (this.isProcessing) return;
    
    const textArea = this.getActiveTextArea();
    this.dbg('replace: active text area found:', !!textArea);
    if (!textArea) {
      this.showNotification('No text area found. Click in a text input field first.', 'error');
      return;
    }

    const draftText = this.getTextFromElement(textArea);
    this.dbg('replace: draft length:', draftText.length, 'preview:', this.truncate(draftText, 200));
    if (!draftText.trim()) {
      this.showNotification('No draft text found. Type something first.', 'error');
      return;
    }

    this.currentTextArea = textArea;
    this.originalText = draftText;
    this.isProcessing = true;

    try {
      // Get conversation history
      const conversationHistory = this.extractConversationHistory();
      this.dbg('replace: conversation items:', conversationHistory.length);
      this.dbg('replace: conversation sample:', conversationHistory.slice(-3));
      
      // Send to background script for API call
      try {
        chrome.runtime.sendMessage({
          action: 'refineText',
          data: {
            draftText: draftText,
            conversationHistory: conversationHistory,
            action: 'replace' // Direct replace mode
          }
        });
        this.dbg('replace: message sent to background');
      } catch (error) {
        console.error('Error sending message to background:', error);
        this.showNotification('Extension communication error. Please reload the page.', 'error');
        this.isProcessing = false;
      }

      this.showNotification('Refining and replacing your message...', 'info');
    } catch (error) {
      console.error('Error in replace:', error);
      this.showNotification('Error: ' + error.message, 'error');
      this.isProcessing = false;
    }
  }

  handleRefinementComplete(data) {
    this.isProcessing = false;
    this.refinedText = data.refinedText;
    this.dbg('refinement complete; action:', data.action, 'refined length:', (data.refinedText || '').length, 'preview:', this.truncate(data.refinedText, 200));
    
    if (data.action === 'preview') {
      this.showRefinementPopup();
    } else if (data.action === 'replace') {
      this.replaceText();
    }
  }

  handleRefinementError(error) {
    this.isProcessing = false;
    this.dbg('refinement error:', error);
    this.showNotification('Refinement failed: ' + error, 'error');
  }

  getActiveTextArea() {
    const activeElement = document.activeElement;
    
    // Check if active element is a text input
    if (this.isTextInput(activeElement)) {
      return activeElement;
    }

    // Look for common text input selectors
    const textInputSelectors = [
      'input[type="text"]',
      'input[type="email"]',
      'input[type="search"]',
      'textarea',
      '[contenteditable="true"]',
      '[contenteditable=""]',
      '.compose-text',
      '.message-input',
      '.chat-input',
      '.reply-input',
      '[role="textbox"]'
    ];

    for (const selector of textInputSelectors) {
      const element = document.querySelector(selector);
      if (element && this.isTextInput(element)) {
        return element;
      }
    }

    return null;
  }

  isTextInput(element) {
    if (!element) return false;
    
    const tagName = element.tagName.toLowerCase();
    const type = element.type ? element.type.toLowerCase() : '';
    
    return (
      tagName === 'textarea' ||
      (tagName === 'input' && ['text', 'email', 'search'].includes(type)) ||
      element.contentEditable === 'true' ||
      element.getAttribute('role') === 'textbox'
    );
  }

  getTextFromElement(element) {
    if (element.contentEditable === 'true' || element.contentEditable === '') {
      return element.innerText || element.textContent || '';
    }
    return element.value || '';
  }

  setTextInElement(element, text) {
    if (element.contentEditable === 'true' || element.contentEditable === '') {
      element.innerText = text;
      element.textContent = text;
      
      // Trigger input event for React/Vue components
      const event = new Event('input', { bubbles: true });
      element.dispatchEvent(event);
    } else {
      element.value = text;
      
      // Trigger input event for React/Vue components
      const event = new Event('input', { bubbles: true });
      element.dispatchEvent(event);
    }
  }

  extractConversationHistory() {
    const conversation = [];
    const maxTokens = 2000;
    let currentTokens = 0;

    // Debug: start log group
    this.dbgGroup('Scanning conversation history');

    // Common selectors for chat messages
    const messageSelectors = [
      '.message',
      '.msg',
      '.chat-message',
      '.conversation-item',
      '.thread-item',
      '.comment',
      '.reply',
      '[data-testid*="message"]',
      '[data-testid*="msg"]',
      '.conversation-message',
      '.chat-bubble',
      '.message-content'
    ];

    const messages = [];
    
    for (const selector of messageSelectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const text = this.extractMessageText(el);
        if (text && text.trim()) {
          messages.push({
            element: el,
            text: text.trim(),
            timestamp: this.extractTimestamp(el)
          });
        }
      });
    }

    // Sort by timestamp or position
    messages.sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return new Date(a.timestamp) - new Date(b.timestamp);
      }
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    // Build conversation with token limit
    for (const msg of messages) {
      const tokens = this.estimateTokens(msg.text);
      if (currentTokens + tokens > maxTokens) break;
      
      const isFromUser = this.isFromUser(msg.element);
      conversation.push({
        sender: isFromUser ? 'me' : 'other',
        text: msg.text,
        timestamp: msg.timestamp
      });
      currentTokens += tokens;

      // Debug each included message
      this.dbg('included', {
        sender: isFromUser ? 'me' : 'other',
        tokens,
        textPreview: this.truncate(msg.text, 200),
        timestamp: msg.timestamp
      });
    }

    // Debug: summary
    this.dbg('total messages:', conversation.length, 'approxTokens:', currentTokens);
    this.dbgGroupEnd();

    return conversation;
  }

  extractMessageText(element) {
    // Try to get clean text content
    const textSelectors = [
      '.message-text',
      '.msg-text',
      '.content',
      '.text',
      '.body',
      '.message-content',
      '.chat-content'
    ];

    for (const selector of textSelectors) {
      const textEl = element.querySelector(selector);
      if (textEl) {
        const text = textEl.innerText || textEl.textContent || '';
        // Debug raw extraction
        try {
          console.debug?.('[ChatRefinement] extracted via selector', selector, '→', text.length, 'chars');
        } catch (_) {}
        return text;
      }
    }

    // Fallback to element's own text
    const fallback = element.innerText || element.textContent || '';
    try {
      console.debug?.('[ChatRefinement] extracted via fallback', '→', fallback.length, 'chars');
    } catch (_) {}
    return fallback;
  }

  extractTimestamp(element) {
    const timeSelectors = [
      '.timestamp',
      '.time',
      '.date',
      '.message-time',
      'time',
      '[datetime]'
    ];

    for (const selector of timeSelectors) {
      const timeEl = element.querySelector(selector);
      if (timeEl) {
        const ts = timeEl.getAttribute('datetime') || timeEl.innerText || timeEl.textContent;
        try {
          console.debug?.('[ChatRefinement] timestamp found via', selector, '→', ts);
        } catch (_) {}
        return ts;
      }
    }

    return null;
  }

  isFromUser(element) {
    // Common indicators that a message is from the current user
    const userIndicators = [
      '.sent',
      '.outgoing',
      '.my-message',
      '.user-message',
      '.own-message',
      '[data-sender="me"]',
      '[data-from="me"]',
      '.message-out',
      '.message-sent'
    ];

    for (const indicator of userIndicators) {
      if (element.matches(indicator) || element.closest(indicator)) {
        try {
          console.debug?.('[ChatRefinement] sender=me via indicator', indicator);
        } catch (_) {}
        return true;
      }
    }

    // Check for right-aligned messages (common in chat apps)
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.textAlign === 'right' || computedStyle.marginLeft === 'auto') {
      try {
        console.debug?.('[ChatRefinement] sender=me via alignment heuristic');
      } catch (_) {}
      return true;
    }

    return false;
  }

  estimateTokens(text) {
    // Rough estimation: 1 token ≈ 4 characters for English
    return Math.ceil(text.length / 4);
  }

  showRefinementPopup() {
    this.hidePopup(); // Remove existing popup

    const popup = document.createElement('div');
    popup.id = 'chat-refinement-popup';
    popup.innerHTML = `
      <div class="refinement-popup">
        <div class="popup-header">
          <h3>Refined Reply</h3>
          <button class="close-btn">&times;</button>
        </div>
        <div class="popup-content">
          <div class="original-text">
            <strong>Original:</strong>
            <div class="text-preview">${this.escapeHtml(this.originalText)}</div>
          </div>
          <div class="refined-text">
            <strong>Refined:</strong>
            <div class="text-preview">${this.escapeHtml(this.refinedText)}</div>
          </div>
        </div>
        <div class="popup-actions">
          <button class="btn btn-primary" id="insert-refined">Insert Refined</button>
          <button class="btn btn-secondary" id="cancel-refined">Cancel</button>
        </div>
      </div>
    `;

    // Add styles
    this.addPopupStyles();

    document.body.appendChild(popup);
    this.popup = popup;

    // Add event listeners
    popup.querySelector('#insert-refined').addEventListener('click', () => {
      this.replaceText();
      this.hidePopup();
    });

    popup.querySelector('#cancel-refined').addEventListener('click', () => {
      this.hidePopup();
    });

    popup.querySelector('.close-btn').addEventListener('click', () => {
      this.hidePopup();
    });

    // Close on escape key
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        this.hidePopup();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);
  }

  replaceText() {
    if (this.currentTextArea && this.refinedText) {
      this.setTextInElement(this.currentTextArea, this.refinedText);
      this.showNotification('Text replaced with refined version', 'success');
    }
  }

  hidePopup() {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
  }

  addPopupStyles() {
    if (document.getElementById('chat-refinement-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'chat-refinement-styles';
    styles.textContent = `
      #chat-refinement-popup {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .refinement-popup {
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        max-width: 600px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .popup-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid #e0e0e0;
        background: #f8f9fa;
      }

      .popup-header h3 {
        margin: 0;
        font-size: 18px;
        color: #333;
      }

      .close-btn {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #666;
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .close-btn:hover {
        color: #333;
      }

      .popup-content {
        padding: 20px;
        max-height: 400px;
        overflow-y: auto;
      }

      .original-text, .refined-text {
        margin-bottom: 16px;
      }

      .original-text strong, .refined-text strong {
        display: block;
        margin-bottom: 8px;
        color: #555;
        font-size: 14px;
      }

      .text-preview {
        background: #f8f9fa;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        padding: 12px;
        white-space: pre-wrap;
        word-wrap: break-word;
        font-size: 14px;
        line-height: 1.4;
        max-height: 120px;
        overflow-y: auto;
      }

      .refined-text .text-preview {
        background: #e8f5e8;
        border-color: #4caf50;
      }

      .popup-actions {
        padding: 16px 20px;
        border-top: 1px solid #e0e0e0;
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }

      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background-color 0.2s;
      }

      .btn-primary {
        background: #007bff;
        color: white;
      }

      .btn-primary:hover {
        background: #0056b3;
      }

      .btn-secondary {
        background: #6c757d;
        color: white;
      }

      .btn-secondary:hover {
        background: #545b62;
      }
    `;

    document.head.appendChild(styles);
  }

  showNotification(message, type = 'info') {
    // Remove existing notification
    const existing = document.getElementById('chat-refinement-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'chat-refinement-notification';
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    // Add notification styles
    if (!document.getElementById('chat-refinement-notification-styles')) {
      const styles = document.createElement('style');
      styles.id = 'chat-refinement-notification-styles';
      styles.textContent = `
        #chat-refinement-notification {
          position: fixed;
          top: 20px;
          right: 20px;
          padding: 12px 20px;
          border-radius: 4px;
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          z-index: 10001;
          max-width: 300px;
          word-wrap: break-word;
        }
        .notification-info { background: #007bff; }
        .notification-success { background: #28a745; }
        .notification-error { background: #dc3545; }
      `;
      document.head.appendChild(styles);
    }

    document.body.appendChild(notification);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the extension
if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime) {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new ChatRefinementExtension();
    });
  } else {
    new ChatRefinementExtension();
  }
} else {
  console.error('Chat Refinement Extension: Chrome runtime not available');
}
