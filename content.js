// Content script for Chat Refinement Assistant
class ChatRefinementExtension {
  constructor() {
    this.isProcessing = false;
    this.refinedText = '';
    this.originalText = '';
    this.currentTextArea = null;
    this.popup = null;
    this.customInstructionBox = null;
    this.customInstruction = '';
    this.isCustomCommandMode = false;
    // NEW: Replacement UI state
    this.diffModel = [];
    this.currentHunkIndex = 0;
    this.replacementPanel = null;
    this.replacementShortcuts = null;
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
      } else if (request.action === 'customCommands') {
        this.dbg('Received customCommands message from background');
        this.handleCustomCommands();
      } else if (request.action === 'refinePreview') {
        this.dbg('Received refinePreview message from background');
        this.handleRefinePreview();
      } else if (request.action === 'refineReplace') {
        this.dbg('Received refineReplace message from background');
        this.handleRefineReplace();
      } else if (request.action === 'ping') {
        // Respond to ping to confirm content script is available
        sendResponse({ status: 'available' });
        return true;
      }
    });
  }

  handleKeyDown(event) {
    // Check for Alt+X (custom commands) or Alt+Q (replace)
    
    // Handle custom instruction box keyboard events
    if (this.isCustomCommandMode && this.customInstructionBox) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        console.log('[KEYBOARD] Enter pressed in custom command mode');
        this.handleCustomInstructionSubmit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        console.log('[KEYBOARD] Escape pressed in custom command mode');
        this.hideCustomInstructionBox();
      }
      return; // Don't process other shortcuts when in custom command mode
    }
    
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      console.log('[KEYBOARD] Alt key combination detected');
      if (event.key === 'x' || event.key === 'X') {
        event.preventDefault();
        console.log('[KEYBOARD] Alt+X detected, calling handleCustomCommands');
        this.dbg('shortcut detected: custom commands (Alt+X)');
        this.handleCustomCommands();
      } else if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault();
        console.log('[KEYBOARD] Alt+Q detected, calling handleRefineReplace');
        this.dbg('shortcut detected: replace (Alt+Q)');
        this.handleRefineReplace();
      }
    }
  }

  // NEW: Handle custom commands (replaces old preview)
  async handleCustomCommands() {
    console.log('[CUSTOM COMMANDS] handleCustomCommands called');
    
    if (this.isProcessing) {
      console.log('[CUSTOM COMMANDS] Already processing, returning');
      return;
    }
    
    // Check if extension context is still valid
    if (!this.isExtensionContextValid()) {
      console.log('[CUSTOM COMMANDS] Extension context invalid');
      this.showNotification('Extension was reloaded. Please refresh the page to continue.', 'error');
      return;
    }
    
    const textArea = this.getActiveTextArea();
    console.log('[CUSTOM COMMANDS] Active text area found:', !!textArea, textArea);
    this.dbg('custom commands: active text area found:', !!textArea);
    if (!textArea) {
      console.log('[CUSTOM COMMANDS] No text area found');
      this.showNotification('No text area found. Click in a text input field first.', 'error');
      return;
    }

    const draftText = this.getTextFromElement(textArea);
    console.log('[CUSTOM COMMANDS] Draft text length:', draftText.length, 'Preview:', this.truncate(draftText, 200));
    this.dbg('custom commands: draft length:', draftText.length, 'preview:', this.truncate(draftText, 200));
    if (!draftText.trim()) {
      console.log('[CUSTOM COMMANDS] No draft text found');
      this.showNotification('No draft text found. Type something first.', 'error');
      return;
    }

    this.currentTextArea = textArea;
    this.originalText = draftText;
    
    console.log('[CUSTOM COMMANDS] About to show custom instruction box');
    // Show custom instruction box
    this.showCustomInstructionBox();
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
      this.showReplacementPanel(); // NEW: Show Cursor-style replacement panel
    } else if (data.action === 'custom') {
      this.showReplacementPanel(); // NEW: Show Cursor-style replacement panel for custom instructions
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
      
      // Position cursor at the end of the text
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = element.firstChild;
      if (textNode) {
        const endOffset = textNode.length;
        range.setStart(textNode, endOffset);
        range.setEnd(textNode, endOffset);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      
      // Trigger input event for React/Vue components
      const event = new Event('input', { bubbles: true });
      element.dispatchEvent(event);
    } else {
      element.value = text;
      
      // Position cursor at the end of the text
      const endPosition = text.length;
      element.setSelectionRange(endPosition, endPosition);
      
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

  // NEW: Build diff model for replacement UI
  buildDiffModel(original, refined) {
    console.log('[REPLACEMENT] Building diff model');
    
    if (original === refined) {
      console.log('[REPLACEMENT] No changes detected');
      return [];
    }

    // Simple word-level diff algorithm
    const originalWords = this.tokenizeText(original);
    const refinedWords = this.tokenizeText(refined);
    
    const hunks = this.computeWordDiff(originalWords, refinedWords);
    
    console.log('[REPLACEMENT] Generated', hunks.length, 'hunks');
    return hunks;
  }

  // Tokenize text into words while preserving whitespace
  tokenizeText(text) {
    const tokens = [];
    const regex = /(\s+|[^\s]+)/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      tokens.push({
        text: match[0],
        isWhitespace: /^\s+$/.test(match[0]),
        start: match.index,
        end: match.index + match[0].length
      });
    }
    
    return tokens;
  }

  // Compute word-level diff using simple LCS approach
  computeWordDiff(original, refined) {
    const hunks = [];
    let i = 0, j = 0;
    
    while (i < original.length || j < refined.length) {
      // Find common prefix
      const commonStart = this.findCommonPrefix(original, refined, i, j);
      i += commonStart;
      j += commonStart;
      
      if (i >= original.length && j >= refined.length) break;
      
      // Find deletion
      const deletion = this.findDeletion(original, refined, i, j);
      // Find insertion
      const insertion = this.findInsertion(original, refined, i, j);
      
      if (deletion.length > 0 || insertion.length > 0) {
        hunks.push({
          type: 'change',
          originalStart: i,
          originalEnd: i + deletion.length,
          refinedStart: j,
          refinedEnd: j + insertion.length,
          originalText: deletion.map(t => t.text).join(''),
          refinedText: insertion.map(t => t.text).join(''),
          originalTokens: deletion,
          refinedTokens: insertion
        });
        
        i += deletion.length;
        j += insertion.length;
      } else {
        // No more changes
        break;
      }
    }
    
    return hunks;
  }

  findCommonPrefix(original, refined, startI, startJ) {
    let count = 0;
    while (startI + count < original.length && 
           startJ + count < refined.length && 
           original[startI + count].text === refined[startJ + count].text) {
      count++;
    }
    return count;
  }

  findDeletion(original, refined, startI, startJ) {
    const deletion = [];
    let i = startI;
    
    while (i < original.length) {
      // Check if this token exists in refined at current position
      let found = false;
      for (let j = startJ; j < Math.min(startJ + 3, refined.length); j++) {
        if (original[i].text === refined[j].text) {
          found = true;
          break;
        }
      }
      
      if (found) break;
      
      deletion.push(original[i]);
      i++;
    }
    
    return deletion;
  }

  findInsertion(original, refined, startI, startJ) {
    const insertion = [];
    let j = startJ;
    
    while (j < refined.length) {
      // Check if this token exists in original at current position
      let found = false;
      for (let i = startI; i < Math.min(startI + 3, original.length); i++) {
        if (refined[j].text === original[i].text) {
          found = true;
          break;
        }
      }
      
      if (found) break;
      
      insertion.push(refined[j]);
      j++;
    }
    
    return insertion;
  }

  // NEW: Show minimalistic replacement panel
  showReplacementPanel() {
    console.log('[REPLACEMENT] showReplacementPanel called');
    
    this.hideReplacementPanel(); // Clean up existing panel
    
    if (this.originalText === this.refinedText) {
      console.log('[REPLACEMENT] No changes to show');
      this.showNotification('No changes detected', 'info');
      return;
    }
    
    // Create minimalistic replacement panel
    this.createMinimalReplacementPanel();
    this.anchorPanelToInput();
    this.installReplacementShortcuts();
    
    console.log('[REPLACEMENT] Minimalistic panel created');
  }

  // Create ultra-minimalistic replacement panel
  createMinimalReplacementPanel() {
    const panel = document.createElement('div');
    panel.id = 'replacement-panel';
    panel.innerHTML = `
      <div class="ultra-minimal-overlay" role="dialog" aria-modal="true" aria-labelledby="refined-text">
        <div class="refined-text" id="refined-text">${this.escapeHtml(this.refinedText)}</div>
        <div class="minimal-actions">
          <button class="minimal-btn reject-btn" id="reject-change" title="Reject (Esc)" aria-label="Reject changes">
            <span class="btn-icon">✗</span>
            <span class="btn-text">Esc</span>
          </button>
          <button class="minimal-btn accept-btn" id="accept-change" title="Accept (Enter)" aria-label="Accept changes">
            <span class="btn-icon">✓</span>
            <span class="btn-text">Enter</span>
          </button>
        </div>
      </div>
    `;

    // Add ultra-minimalistic styles
    this.addUltraMinimalStyles();

    document.body.appendChild(panel);
    this.replacementPanel = panel;
    
    // Focus the accept button by default
    setTimeout(() => {
      const acceptBtn = panel.querySelector('#accept-change');
      if (acceptBtn) {
        acceptBtn.focus();
      }
    }, 10);
    
    // Add event listeners
    this.attachMinimalReplacementListeners();
  }


  // Attach minimalistic event listeners
  attachMinimalReplacementListeners() {
    if (!this.replacementPanel) return;

    // Accept change
    this.replacementPanel.querySelector('#accept-change').addEventListener('click', () => {
      this.applyAll();
    });

    // Reject change
    this.replacementPanel.querySelector('#reject-change').addEventListener('click', () => {
      this.cancelReplacement();
    });

    console.log('[REPLACEMENT] Ultra-minimalistic panel ready');
  }


  // Apply all changes
  applyAll() {
    console.log('[REPLACEMENT] Applying all changes');
    
    if (this.currentTextArea && this.refinedText) {
      this.setTextInElement(this.currentTextArea, this.refinedText);
      this.showNotification('✓ Changes applied', 'success');
      
      // Always place cursor at the end of the text
      setTimeout(() => {
        this.restoreSelection(null, 0);
      }, 10);
    }
    
    this.hideReplacementPanel();
  }

  // Cancel replacement and restore original
  cancelReplacement() {
    console.log('[REPLACEMENT] Cancelling replacement');
    
    if (this.currentTextArea && this.originalText) {
      this.setTextInElement(this.currentTextArea, this.originalText);
      
      // Always place cursor at the end of the text
      setTimeout(() => {
        this.restoreSelection(null, 0);
      }, 10);
    }
    
    this.hideReplacementPanel();
  }

  // Save current text selection
  saveSelection() {
    if (!this.currentTextArea) return null;
    
    if (this.currentTextArea.tagName === 'TEXTAREA') {
      return {
        start: this.currentTextArea.selectionStart,
        end: this.currentTextArea.selectionEnd
      };
    } else if (this.currentTextArea.contentEditable === 'true') {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        return {
          range: selection.getRangeAt(0).cloneRange()
        };
      }
    }
    return null;
  }

  // Restore text selection - always place cursor at end
  restoreSelection(selection, textLength) {
    if (!this.currentTextArea) return;
    
    // Always place cursor at the end of the text
    const finalTextLength = this.currentTextArea.value ? this.currentTextArea.value.length : 
                           this.currentTextArea.textContent ? this.currentTextArea.textContent.length : 0;
    
    if (this.currentTextArea.tagName === 'TEXTAREA') {
      this.currentTextArea.setSelectionRange(finalTextLength, finalTextLength);
      this.currentTextArea.focus();
    } else if (this.currentTextArea.contentEditable === 'true') {
      // For contenteditable, place cursor at the end
      const range = document.createRange();
      const sel = window.getSelection();
      
      // Find the last text node
      const walker = document.createTreeWalker(
        this.currentTextArea,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      
      let lastTextNode = null;
      let node;
      while (node = walker.nextNode()) {
        lastTextNode = node;
      }
      
      if (lastTextNode) {
        const textLength = lastTextNode.textContent.length;
        range.setStart(lastTextNode, textLength);
        range.setEnd(lastTextNode, textLength);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      
      this.currentTextArea.focus();
    }
  }

  // Hide replacement panel
  hideReplacementPanel() {
    if (this.replacementPanel) {
      this.replacementPanel.remove();
      this.replacementPanel = null;
    }
    
    this.removeReplacementShortcuts();
  }

  // Anchor panel to input
  anchorPanelToInput() {
    if (!this.replacementPanel || !this.currentTextArea) return;

    const rect = this.currentTextArea.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    const overlayElement = this.replacementPanel.querySelector('.ultra-minimal-overlay');
    overlayElement.style.position = 'absolute';
    overlayElement.style.zIndex = '10002';
    
    // Position directly above the text area
    const topPosition = Math.max(10, rect.top + scrollTop - 120);
    const leftPosition = rect.left + scrollLeft;
    
    overlayElement.style.top = `${topPosition}px`;
    overlayElement.style.left = `${leftPosition}px`;
    
    // Ensure it doesn't go off-screen horizontally
    const panelWidth = 400;
    const viewportWidth = window.innerWidth;
    
    if (leftPosition + panelWidth > viewportWidth - 10) {
      overlayElement.style.left = `${viewportWidth - panelWidth - 10}px`;
    }
    
    // Ensure it doesn't go off-screen vertically
    if (topPosition < 10) {
      // If it would go above the viewport, position it below the text area instead
      const bottomPosition = rect.bottom + scrollTop + 10;
      overlayElement.style.top = `${bottomPosition}px`;
    }
    
    // Add scroll listener to reposition on scroll
    this.scrollListener = () => {
      this.anchorPanelToInput();
    };
    window.addEventListener('scroll', this.scrollListener, { passive: true });
  }

  // Install minimalistic keyboard shortcuts
  installReplacementShortcuts() {
    this.replacementShortcuts = (e) => {
      if (!this.replacementPanel) return;
      
      console.log('[REPLACEMENT] Key pressed:', e.key);
      
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          e.stopPropagation();
          // Focus and trigger accept button
          const acceptBtn = this.replacementPanel.querySelector('#accept-change');
          if (acceptBtn) {
            acceptBtn.focus();
            acceptBtn.click();
          }
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          // Focus and trigger reject button
          const rejectBtn = this.replacementPanel.querySelector('#reject-change');
          if (rejectBtn) {
            rejectBtn.focus();
            rejectBtn.click();
          }
          break;
      }
    };
    
    // Add click outside to dismiss
    this.clickOutsideListener = (e) => {
      if (this.replacementPanel && !this.replacementPanel.contains(e.target)) {
        this.cancelReplacement();
      }
    };
    
    document.addEventListener('keydown', this.replacementShortcuts);
    document.addEventListener('click', this.clickOutsideListener);
  }

  // Remove keyboard shortcuts
  removeReplacementShortcuts() {
    if (this.replacementShortcuts) {
      document.removeEventListener('keydown', this.replacementShortcuts);
      this.replacementShortcuts = null;
    }
    
    if (this.clickOutsideListener) {
      document.removeEventListener('click', this.clickOutsideListener);
      this.clickOutsideListener = null;
    }
    
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener);
      this.scrollListener = null;
    }
  }

  // NEW: Show custom instruction box
  showCustomInstructionBox() {
    console.log('[CUSTOM COMMANDS] showCustomInstructionBox called');
    
    this.hideCustomInstructionBox(); // Remove existing box

    const instructionBox = document.createElement('div');
    instructionBox.id = 'custom-instruction-box';
    instructionBox.innerHTML = `
      <div class="custom-instruction-overlay">
        <div class="custom-instruction-content">
          <div class="instruction-label">Custom Instructions:</div>
          <input type="text" 
                 id="custom-instruction-input" 
                 class="custom-instruction-input" 
                 placeholder="e.g - write formally, add humor, be casual..."
                 autocomplete="off"
                 spellcheck="false" />
        </div>
      </div>
    `;

    console.log('[CUSTOM COMMANDS] Created instruction box HTML');

    // Add custom instruction styles
    this.addCustomInstructionStyles();
    console.log('[CUSTOM COMMANDS] Added custom instruction styles');

    // Position the box above the text area
    this.positionCustomInstructionBox(instructionBox);
    console.log('[CUSTOM COMMANDS] Positioned instruction box');

    document.body.appendChild(instructionBox);
    console.log('[CUSTOM COMMANDS] Appended instruction box to body');
    
    this.customInstructionBox = instructionBox;
    this.isCustomCommandMode = true;
    console.log('[CUSTOM COMMANDS] Set custom command mode to true');

    // Focus the input immediately
    const input = instructionBox.querySelector('#custom-instruction-input');
    console.log('[CUSTOM COMMANDS] Found input element:', !!input);
    
    setTimeout(() => {
      console.log('[CUSTOM COMMANDS] Focusing input');
      input.focus();
      input.select();
    }, 10);

    // Add keyboard event listener for the input
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        console.log('[CUSTOM COMMANDS] Enter pressed, submitting');
        this.handleCustomInstructionSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        console.log('[CUSTOM COMMANDS] Escape pressed, hiding box');
        this.hideCustomInstructionBox();
      }
    });
    
    console.log('[CUSTOM COMMANDS] showCustomInstructionBox completed');
  }

  // NEW: Handle custom instruction submission
  async handleCustomInstructionSubmit() {
    console.log('[CUSTOM COMMANDS] handleCustomInstructionSubmit called');
    
    const input = this.customInstructionBox.querySelector('#custom-instruction-input');
    const customInstruction = input.value.trim();
    
    console.log('[CUSTOM COMMANDS] Custom instruction:', customInstruction);
    
    if (!customInstruction) {
      console.log('[CUSTOM COMMANDS] No custom instruction provided');
      this.showNotification('Please enter a custom instruction', 'error');
      return;
    }

    this.customInstruction = customInstruction;
    this.isProcessing = true;
    this.hideCustomInstructionBox();
    console.log('[CUSTOM COMMANDS] Hidden instruction box, starting processing');

    try {
      // Get conversation history
      const conversationHistory = this.extractConversationHistory();
      console.log('[CUSTOM COMMANDS] Extracted conversation history:', conversationHistory.length, 'messages');
      
      // Send to background script for API call with custom instruction
      try {
        console.log('[CUSTOM COMMANDS] Sending message to background script');
        chrome.runtime.sendMessage({
          action: 'refineText',
          data: {
            draftText: this.originalText,
            conversationHistory: conversationHistory,
            customInstruction: customInstruction,
            action: 'custom' // Custom instruction mode
          }
        });
        console.log('[CUSTOM COMMANDS] Message sent to background script');
      } catch (error) {
        console.error('[CUSTOM COMMANDS] Error sending message to background:', error);
        if (error.message.includes('Extension context invalidated')) {
          this.showNotification('Extension was reloaded. Please refresh the page to continue.', 'error');
        } else {
          this.showNotification('Extension communication error. Please reload the page.', 'error');
        }
        this.isProcessing = false;
      }

      this.showNotification(`Refining with custom instruction: "${customInstruction}"...`, 'info');
    } catch (error) {
      console.error('[CUSTOM COMMANDS] Error in custom instruction:', error);
      this.showNotification('Error: ' + error.message, 'error');
      this.isProcessing = false;
    }
  }

  // NEW: Hide custom instruction box
  hideCustomInstructionBox() {
    console.log('[CUSTOM COMMANDS] hideCustomInstructionBox called');
    if (this.customInstructionBox) {
      console.log('[CUSTOM COMMANDS] Removing custom instruction box');
      this.customInstructionBox.remove();
      this.customInstructionBox = null;
    }
    this.isCustomCommandMode = false;
    console.log('[CUSTOM COMMANDS] Custom command mode set to false');
  }

  // NEW: Position custom instruction box above text area
  positionCustomInstructionBox(instructionBox) {
    console.log('[CUSTOM COMMANDS] positionCustomInstructionBox called');
    
    if (!this.currentTextArea) {
      console.log('[CUSTOM COMMANDS] No current text area, cannot position');
      return;
    }

    const rect = this.currentTextArea.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    console.log('[CUSTOM COMMANDS] Text area rect:', rect);
    console.log('[CUSTOM COMMANDS] Scroll position:', { scrollTop, scrollLeft });

    // Position above the text input
    const overlayElement = instructionBox.querySelector('.custom-instruction-overlay');
    overlayElement.style.position = 'absolute';
    overlayElement.style.zIndex = '10001';
    
    // Calculate position to place it above the text area
    const topPosition = Math.max(10, rect.top + scrollTop - 80); // Position 80px above the text area
    const leftPosition = rect.left + scrollLeft;
    
    overlayElement.style.top = `${topPosition}px`;
    overlayElement.style.left = `${leftPosition}px`;
    
    console.log('[CUSTOM COMMANDS] Positioned at:', { topPosition, leftPosition });
    
    // Ensure it doesn't go off-screen horizontally
    const overlayWidth = 400; // Approximate width
    const viewportWidth = window.innerWidth;
    const rightEdge = leftPosition + overlayWidth;
    
    if (rightEdge > viewportWidth - 10) {
      const newLeftPosition = viewportWidth - overlayWidth - 10;
      overlayElement.style.left = `${newLeftPosition}px`;
      console.log('[CUSTOM COMMANDS] Adjusted left position to:', newLeftPosition);
    }
    
    // Ensure it doesn't go off-screen vertically
    if (topPosition < 10) {
      // If it would go above the viewport, position it below the text area instead
      const bottomPosition = rect.bottom + scrollTop + 10;
      overlayElement.style.top = `${bottomPosition}px`;
      console.log('[CUSTOM COMMANDS] Adjusted to position below text area:', bottomPosition);
    }
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

    // No auto-accept for preview mode - wait for user input
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

  // Add ultra-minimalistic styles
  addUltraMinimalStyles() {
    if (document.getElementById('ultra-minimal-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'ultra-minimal-styles';
    styles.textContent = `
      #replacement-panel {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10000;
      }

      .ultra-minimal-overlay {
        background: rgba(0, 0, 0, 0.85);
        border-radius: 6px;
        max-width: 500px;
        width: fit-content;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        pointer-events: auto;
        animation: fadeIn 0.15s ease-out;
        position: absolute;
        z-index: 10002;
        color: #ffffff;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(-5px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .refined-text {
        color: #ffffff;
        padding: 12px 16px;
        font-size: 14px;
        line-height: 1.4;
        word-wrap: break-word;
        white-space: pre-wrap;
        max-height: 150px;
        overflow-y: auto;
      }

      .minimal-actions {
        display: flex;
        gap: 8px;
        padding: 8px 16px 12px 16px;
        justify-content: center;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .minimal-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        min-width: 60px;
        justify-content: center;
      }

      .minimal-btn.accept-btn {
        background: #28a745;
        color: white;
      }

      .minimal-btn.accept-btn:hover {
        background: #218838;
      }

      .minimal-btn.accept-btn:focus {
        outline: 2px solid #28a745;
        outline-offset: 2px;
      }

      .minimal-btn.reject-btn {
        background: #dc3545;
        color: white;
      }

      .minimal-btn.reject-btn:hover {
        background: #c82333;
      }

      .minimal-btn.reject-btn:focus {
        outline: 2px solid #dc3545;
        outline-offset: 2px;
      }

      .btn-icon {
        font-size: 10px;
      }

      .btn-text {
        font-size: 10px;
        font-weight: 500;
      }
    `;

    document.head.appendChild(styles);
  }

  // Add custom instruction styles
  addCustomInstructionStyles() {
    if (document.getElementById('custom-instruction-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'custom-instruction-styles';
    styles.textContent = `
      #custom-instruction-box {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10000;
      }

      .custom-instruction-overlay {
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
        position: absolute;
        z-index: 10001;
      }

      @keyframes slideInFromTop {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .custom-instruction-content {
        padding: 12px;
      }

      .instruction-label {
        font-size: 12px;
        font-weight: 600;
        color: #555;
        margin-bottom: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .custom-instruction-input {
        width: 100%;
        padding: 8px 12px;
        border: 2px solid #007bff;
        border-radius: 4px;
        font-size: 14px;
        font-family: inherit;
        outline: none;
        transition: border-color 0.2s;
        box-sizing: border-box;
      }

      .custom-instruction-input:focus {
        border-color: #0056b3;
        box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
      }

      .instruction-hint {
        font-size: 11px;
        color: #666;
        margin-top: 4px;
        text-align: center;
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
