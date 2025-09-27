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

  isExtensionContextValid() {
    try {
      chrome.runtime.getManifest();
      return true;
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        return false;
      }
      throw error;
    }
  }

  init() {
    // Check if Chrome runtime is available
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      console.error('Chrome runtime not available');
      return;
    }

    // Check if extension context is still valid
    try {
      chrome.runtime.getManifest();
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        console.error('Extension context invalidated - extension was reloaded');
        this.showNotification('Extension was reloaded. Please refresh the page to continue.', 'error');
        return;
      }
      throw error;
    }

    // Listen for keyboard shortcuts
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'refinementComplete') {
        this.handleRefinementComplete(request.data);
      } else if (request.action === 'refinementError') {
        this.handleRefinementError(request.error);
      } else if (request.action === 'refinePreview') {
        this.dbg('Received refinePreview message from background');
        this.handleRefinePreview();
      } else if (request.action === 'refineReplace') {
        this.dbg('Received refineReplace message from background');
        this.handleRefineReplace();
      }
    });
  }

  handleKeyDown(event) {
    // Check for Alt+X (preview) or Alt+Q (replace)
    this.dbg('keydown', { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey, key: event.key });
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === 'x' || event.key === 'X') {
        event.preventDefault();
        this.dbg('shortcut detected: preview (Alt+X)');
        this.handleRefinePreview();
      } else if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault();
        this.dbg('shortcut detected: replace (Alt+Q)');
        this.handleRefineReplace();
      }
    }
  }

  async handleRefinePreview() {
    if (this.isProcessing) return;
    
    // Check if extension context is still valid
    if (!this.isExtensionContextValid()) {
      this.showNotification('Extension was reloaded. Please refresh the page to continue.', 'error');
      return;
    }
    
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
      } catch (error) {
        console.error('Error sending message to background:', error);
        if (error.message.includes('Extension context invalidated')) {
          this.showNotification('Extension was reloaded. Please refresh the page to continue.', 'error');
        } else {
          this.showNotification('Extension communication error. Please reload the page.', 'error');
        }
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
    
    // Check if extension context is still valid
    if (!this.isExtensionContextValid()) {
      this.showNotification('Extension was reloaded. Please refresh the page to continue.', 'error');
      return;
    }
    
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
      } catch (error) {
        console.error('Error sending message to background:', error);
        if (error.message.includes('Extension context invalidated')) {
          this.showNotification('Extension was reloaded. Please refresh the page to continue.', 'error');
        } else {
          this.showNotification('Extension communication error. Please reload the page.', 'error');
        }
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
      this.showInlineTextHighlighting(); // Use ultra-minimal inline highlighting
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
      '.message-content',
      // Additional common selectors
      'div[role="listitem"]',
      'div[role="article"]',
      '.conversation',
      '.chat',
      '.thread',
      '.discussion',
      '.post',
      '.tweet',
      '.status',
      'article',
      'section[class*="message"]',
      'div[class*="message"]',
      'div[class*="chat"]',
      'div[class*="conversation"]'
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

    // If no messages found with selectors, try a fallback approach
    if (messages.length === 0) {
      // Look for any divs with substantial text content that might be messages
      const allDivs = document.querySelectorAll('div');
      
      let fallbackMessages = [];
      allDivs.forEach((div, index) => {
        const text = (div.innerText || div.textContent || '').trim();
        // Look for divs with reasonable text length (likely messages)
        if (text.length > 10 && text.length < 1000 && !text.includes('\n\n\n')) {
          // Check if this div has any of the common message indicators
          const hasMessageIndicators = div.className.includes('message') || 
                                    div.className.includes('chat') || 
                                    div.className.includes('conversation') ||
                                    div.className.includes('msg') ||
                                    div.getAttribute('role') === 'listitem' ||
                                    div.getAttribute('role') === 'article';
          
          if (hasMessageIndicators) {
            fallbackMessages.push({
              element: div,
              text: text,
              timestamp: this.extractTimestamp(div)
            });
          }
        }
      });
      
      messages.push(...fallbackMessages);
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

  // New minimal inline overlay method
  showMinimalRefinementOverlay() {
    this.hidePopup(); // Remove existing popup

    const overlay = document.createElement('div');
    overlay.id = 'chat-refinement-minimal-overlay';
    overlay.innerHTML = `
      <div class="minimal-refinement-overlay">
        <div class="overlay-content">
          <div class="refined-text-preview">${this.escapeHtml(this.refinedText)}</div>
          <div class="overlay-actions">
            <button class="btn-minimal btn-accept" id="accept-refined" title="Accept (Enter)">✓ Enter</button>
            <button class="btn-minimal btn-reject" id="reject-refined" title="Reject (Esc)">✗ Esc</button>
          </div>
        </div>
      </div>
    `;

    // Add minimal styles
    this.addMinimalOverlayStyles();

    // Position relative to text input
    this.positionOverlayNearInput(overlay);

    document.body.appendChild(overlay);
    this.popup = overlay;

    // Add event listeners
    overlay.querySelector('#accept-refined').addEventListener('click', () => {
      this.replaceText();
      this.hidePopup();
    });

    overlay.querySelector('#reject-refined').addEventListener('click', () => {
      this.hidePopup();
    });

    // Keyboard shortcuts
    const keyHandler = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.replaceText();
        this.hidePopup();
        document.removeEventListener('keydown', keyHandler);
      } else if (e.key === 'Escape') {
        this.hidePopup();
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if (this.popup && this.popup.id === 'chat-refinement-minimal-overlay') {
        this.hidePopup();
      }
    }, 10000);
  }

  // NEW: Ultra-minimal inline text highlighting method
  showInlineTextHighlighting() {
    this.hidePopup(); // Remove existing popup

    if (!this.currentTextArea || !this.refinedText) return;

    // Store original text for restoration
    this.originalText = this.getTextFromElement(this.currentTextArea);
    
    // Create diff visualization
    const diff = this.createTextDiff(this.originalText, this.refinedText);
    
    // Temporarily replace text with highlighted version
    this.setTextInElement(this.currentTextArea, this.refinedText);
    
    // Add highlighting styles to the text input
    this.addInlineHighlightingStyles();
    this.currentTextArea.classList.add('refinement-highlighted');
    
    // Create mini floating controls
    this.createMiniFloatingControls();
    
    // Add keyboard shortcuts
    const keyHandler = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.acceptInlineRefinement();
        document.removeEventListener('keydown', keyHandler);
      } else if (e.key === 'Escape') {
        this.rejectInlineRefinement();
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);

    // Auto-accept after 5 seconds
    this.autoAcceptTimeout = setTimeout(() => {
      this.acceptInlineRefinement();
    }, 5000);
  }

  // Position overlay near the text input
  positionOverlayNearInput(overlay) {
    if (!this.currentTextArea) return;

    const rect = this.currentTextArea.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    // Position above the text input, centered
    const overlayElement = overlay.querySelector('.minimal-refinement-overlay');
    overlayElement.style.position = 'absolute';
    
    // Calculate position with viewport bounds checking
    const topPosition = Math.max(10, rect.top + scrollTop - 10); // At least 10px from top
    const leftPosition = rect.left + scrollLeft + (rect.width / 2);
    
    overlayElement.style.top = `${topPosition}px`;
    overlayElement.style.left = `${leftPosition}px`;
    overlayElement.style.transform = 'translateX(-50%)'; // Center horizontally
    
    // Ensure it doesn't go off-screen horizontally
    const overlayWidth = 300; // Approximate width for compact buttons
    const viewportWidth = window.innerWidth;
    const leftEdge = leftPosition - (overlayWidth / 2);
    const rightEdge = leftPosition + (overlayWidth / 2);
    
    if (leftEdge < 10) {
      overlayElement.style.left = `${10 + (overlayWidth / 2)}px`;
    } else if (rightEdge > viewportWidth - 10) {
      overlayElement.style.left = `${viewportWidth - 10 - (overlayWidth / 2)}px`;
    }
  }

  // Create text diff for highlighting
  createTextDiff(original, refined) {
    // Simple diff algorithm - highlight the entire refined text
    return {
      original: original,
      refined: refined,
      changes: refined !== original
    };
  }

  // Create mini floating controls
  createMiniFloatingControls() {
    if (!this.currentTextArea) return;

    const controls = document.createElement('div');
    controls.id = 'inline-refinement-controls';
    controls.innerHTML = `
      <div class="mini-controls">
        <button class="mini-btn mini-accept" id="mini-accept" title="Accept (Enter)">✓ Enter</button>
        <button class="mini-btn mini-reject" id="mini-reject" title="Reject (Esc)">✗ Esc</button>
      </div>
    `;

    // Position near the text input
    const rect = this.currentTextArea.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    controls.style.position = 'absolute';
    controls.style.top = `${rect.bottom + scrollTop + 5}px`;
    controls.style.left = `${rect.right + scrollLeft - 120}px`; // Wider buttons need more space
    controls.style.zIndex = '10001';

    document.body.appendChild(controls);
    this.miniControls = controls;

    // Add event listeners
    controls.querySelector('#mini-accept').addEventListener('click', () => {
      this.acceptInlineRefinement();
    });

    controls.querySelector('#mini-reject').addEventListener('click', () => {
      this.rejectInlineRefinement();
    });
  }

  // Accept inline refinement
  acceptInlineRefinement() {
    if (this.autoAcceptTimeout) {
      clearTimeout(this.autoAcceptTimeout);
      this.autoAcceptTimeout = null;
    }
    
    this.cleanupInlineHighlighting();
    this.showNotification('Text refined successfully', 'success');
  }

  // Reject inline refinement
  rejectInlineRefinement() {
    if (this.autoAcceptTimeout) {
      clearTimeout(this.autoAcceptTimeout);
      this.autoAcceptTimeout = null;
    }
    
    // Restore original text
    if (this.currentTextArea && this.originalText) {
      this.setTextInElement(this.currentTextArea, this.originalText);
    }
    
    this.cleanupInlineHighlighting();
  }

  // Cleanup inline highlighting
  cleanupInlineHighlighting() {
    // Remove highlighting class
    if (this.currentTextArea) {
      this.currentTextArea.classList.remove('refinement-highlighted');
    }
    
    // Remove mini controls
    if (this.miniControls) {
      this.miniControls.remove();
      this.miniControls = null;
    }
    
    // Remove inline highlighting styles
    const styles = document.getElementById('inline-highlighting-styles');
    if (styles) {
      styles.remove();
    }
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

  // Add minimal overlay styles
  addMinimalOverlayStyles() {
    if (document.getElementById('chat-refinement-minimal-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'chat-refinement-minimal-styles';
    styles.textContent = `
      #chat-refinement-minimal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10000;
      }

      .minimal-refinement-overlay {
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        max-width: 400px;
        min-width: 300px;
        width: fit-content;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        pointer-events: auto;
        animation: slideInFromTop 0.2s ease-out;
      }

      @keyframes slideInFromTop {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      .overlay-content {
        padding: 12px;
      }

      .refined-text-preview {
        background: #f8f9fa;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        padding: 8px 12px;
        margin-bottom: 8px;
        font-size: 14px;
        line-height: 1.4;
        max-height: 100px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-wrap: break-word;
        color: #333;
      }

      .overlay-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }

      .btn-minimal {
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s;
        width: auto;
        white-space: nowrap;
      }

      .btn-accept {
        background: #28a745;
        color: white;
      }

      .btn-accept:hover {
        background: #218838;
        transform: scale(1.05);
      }

      .btn-reject {
        background: #dc3545;
        color: white;
      }

      .btn-reject:hover {
        background: #c82333;
        transform: scale(1.05);
      }

      .btn-minimal:focus {
        outline: 2px solid #007bff;
        outline-offset: 2px;
      }
    `;

    document.head.appendChild(styles);
  }

  // Add inline highlighting styles
  addInlineHighlightingStyles() {
    if (document.getElementById('inline-highlighting-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'inline-highlighting-styles';
    styles.textContent = `
      .refinement-highlighted {
        background: linear-gradient(90deg, 
          rgba(40, 167, 69, 0.1) 0%, 
          rgba(40, 167, 69, 0.05) 50%, 
          rgba(40, 167, 69, 0.1) 100%);
        border: 2px solid #28a745 !important;
        border-radius: 4px !important;
        box-shadow: 0 0 0 1px rgba(40, 167, 69, 0.3) !important;
        transition: all 0.3s ease !important;
      }

      #inline-refinement-controls {
        position: absolute;
        z-index: 10001;
        pointer-events: auto;
      }

      .mini-controls {
        display: flex;
        gap: 4px;
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        padding: 4px;
        animation: fadeInScale 0.2s ease-out;
      }

      @keyframes fadeInScale {
        from {
          opacity: 0;
          transform: scale(0.8);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .mini-btn {
        padding: 4px 8px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
        min-width: 50px;
      }

      .mini-accept {
        background: #28a745;
        color: white;
      }

      .mini-accept:hover {
        background: #218838;
        transform: scale(1.1);
      }

      .mini-reject {
        background: #dc3545;
        color: white;
      }

      .mini-reject:hover {
        background: #c82333;
        transform: scale(1.1);
      }

      .mini-btn:focus {
        outline: 2px solid #007bff;
        outline-offset: 1px;
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
