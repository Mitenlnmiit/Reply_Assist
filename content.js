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
    
    // Debug logging
    this.dbg('getActiveTextArea called');
    this.dbg('activeElement:', activeElement?.tagName, activeElement?.className, activeElement?.id);
    
    // Check if active element is a text input
    if (this.isTextInput(activeElement)) {
      this.dbg('Active element is text input');
      return activeElement;
    }

    // Reddit-specific selectors first
    const redditSelectors = [
      // Reddit post title input (contenteditable div)
      '[placeholder*="Title"]',
      '[placeholder*="title"]',
      '.public-DraftEditor-content',
      '.DraftEditor-editorContainer [contenteditable="true"]',
      'div[name="title"]',
      'div[data-contents="true"]',
      // Reddit comment/text editor
      '.md-container textarea',
      '.usertext-edit textarea',
      'div[role="textbox"][contenteditable="true"]',
      '[data-test-id="comment-composer"]',
      // New Reddit selectors
      '[data-testid="post-title"]',
      'div[contenteditable="true"][spellcheck]',
      'div[contenteditable="true"][data-lexical-editor="true"]'
    ];

    // Try Reddit selectors first
    for (const selector of redditSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        this.dbg('Found Reddit element with selector:', selector);
        if (this.isTextInput(element)) {
          return element;
        }
      }
    }

    // LinkedIn-specific selectors
    const linkedinSelectors = [
      // LinkedIn message composer
      '.msg-form__contenteditable[contenteditable="true"]',
      '.msg-form__msg-content-container .ql-editor[contenteditable="true"]',
      '.comments-comment-texteditor .ql-editor[contenteditable="true"]',
      '.share-creation-state__text-editor .ql-editor[contenteditable="true"]',
      '.feed-shared-update-v2__description-wrapper .ql-editor[contenteditable="true"]',
      // Generic LinkedIn patterns
      '.ql-editor[contenteditable="true"][data-placeholder*="comment"]',
      '.ql-editor[contenteditable="true"][data-placeholder*="message"]',
      '.ql-editor[contenteditable="true"][aria-label*="message"]',
      '.ql-editor[contenteditable="true"][aria-label*="comment"]',
      // LinkedIn message input with specific attributes
      'div[contenteditable="true"][data-test-ql-editor-contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="Text editor"]',
      // Fallback LinkedIn patterns
      'div.ql-editor[contenteditable="true"]',
      '.msg-form div[contenteditable="true"]'
    ];

    // Try LinkedIn selectors
    for (const selector of linkedinSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        this.dbg('Found LinkedIn element with selector:', selector);
        if (this.isTextInput(element)) {
          return element;
        }
      }
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
        this.dbg('Found element with generic selector:', selector);
        return element;
      }
    }

    this.dbg('No text area found');
    return null;
  }

  isTextInput(element) {
    if (!element) return false;
    
    const tagName = element.tagName.toLowerCase();
    const type = element.type ? element.type.toLowerCase() : '';
    
    // Debug logging
    this.dbg('isTextInput check:', {
      tagName,
      type,
      contentEditable: element.contentEditable,
      role: element.getAttribute('role'),
      placeholder: element.getAttribute('placeholder'),
      className: element.className
    });
    
    // Check for Reddit-specific contenteditable divs
    const isRedditTitle = element.getAttribute('placeholder')?.toLowerCase().includes('title');
    const isDraftEditor = element.className?.includes('DraftEditor') || 
                         element.className?.includes('public-DraftEditor');
    const isLexicalEditor = element.getAttribute('data-lexical-editor') === 'true';
    
    // Check for LinkedIn-specific editors
    const isLinkedInQuill = element.className?.includes('ql-editor');
    const isLinkedInMessageBox = element.getAttribute('data-test-ql-editor-contenteditable') === 'true';
    const isLinkedInTextEditor = element.getAttribute('aria-label')?.toLowerCase().includes('text editor');
    const isLinkedInCommentBox = element.getAttribute('data-placeholder')?.toLowerCase().includes('comment') ||
                                element.getAttribute('aria-placeholder')?.toLowerCase().includes('comment');
    const isLinkedInMessageInput = element.closest('.msg-form') !== null ||
                                  element.closest('.comments-comment-texteditor') !== null ||
                                  element.closest('.share-creation-state__text-editor') !== null;
    
    return (
      tagName === 'textarea' ||
      (tagName === 'input' && ['text', 'email', 'search', ''].includes(type)) ||
      element.contentEditable === 'true' ||
      element.getAttribute('role') === 'textbox' ||
      isRedditTitle ||
      isDraftEditor ||
      isLexicalEditor ||
      isLinkedInQuill ||
      isLinkedInMessageBox ||
      isLinkedInTextEditor ||
      isLinkedInCommentBox ||
      isLinkedInMessageInput
    );
  }

  getTextFromElement(element) {
    this.dbg('getTextFromElement called for:', element.tagName, element.className);
    
    // For Reddit's Draft.js editor or similar
    if (element.className?.includes('DraftEditor') || 
        element.className?.includes('public-DraftEditor')) {
      const text = element.innerText || element.textContent || '';
      this.dbg('Got text from Draft.js editor:', this.truncate(text, 100));
      return text;
    }
    
    if (element.contentEditable === 'true' || element.contentEditable === '') {
      const text = element.innerText || element.textContent || '';
      this.dbg('Got text from contentEditable:', this.truncate(text, 100));
      return text;
    }
    
    const text = element.value || '';
    this.dbg('Got text from value:', this.truncate(text, 100));
    return text;
  }

  /**
   * Seamlessly replace text in any element using modern methods
   * This avoids character-by-character typing and feels natural
   */
  async setTextInElement(element, text) {
    this.dbg('setTextInElement called with text length:', text.length);
    this.dbg('Element details:', {
      tagName: element.tagName,
      className: element.className,
      contentEditable: element.contentEditable
    });

    // Try methods in order of preference (most seamless first)
    const methods = [
      () => this.replaceTextWithClipboard(element, text),
      () => this.replaceTextWithExecCommand(element, text),
      () => this.replaceTextDirect(element, text)
    ];

    for (let i = 0; i < methods.length; i++) {
      try {
        const success = await methods[i]();
        if (success) {
          this.dbg(`Text replacement successful using method ${i + 1}`);
          return;
        }
      } catch (error) {
        this.dbg(`Method ${i + 1} failed:`, error);
      }
    }

    this.dbg('All text replacement methods failed, using fallback');
    this.fallbackTextReplacement(element, text);
  }

  /**
   * Method 1: Clipboard + Paste (Most Seamless)
   * Simulates natural Ctrl+A, Ctrl+V behavior
   */
  async replaceTextWithClipboard(element, text) {
    try {
      // Focus the element
      element.focus();
      
      // Check for Reddit-specific editors first
      const isDraftEditor = element.className?.includes('DraftEditor') || 
                           element.className?.includes('public-DraftEditor');
      const isLexicalEditor = element.getAttribute('data-lexical-editor') === 'true';
      
      if (isDraftEditor || isLexicalEditor) {
        this.dbg('Detected Reddit editor, using specialized replacement');
        return await this.replaceTextInRedditEditor(element, text);
      }
      
      // Ensure complete text selection and clearing
      if (element.contentEditable === 'true' || element.contentEditable === '') {
        // For contenteditable elements - use comprehensive selection strategy
        
        // Get current text to verify selection
        const originalText = this.getTextFromElement(element);
        this.dbg('Original text to select:', this.truncate(originalText, 100));
        
        // Method 1: Force complete selection using multiple approaches
        let selectionSuccess = false;
        
        // Try selectAll first
        document.execCommand('selectAll', false, null);
        let selectedText = window.getSelection().toString();
        
        if (selectedText && selectedText.length >= originalText.length * 0.9) {
          selectionSuccess = true;
          this.dbg('selectAll worked, selected:', selectedText.length, 'of', originalText.length);
        } else {
          this.dbg('selectAll failed or incomplete, trying manual selection');
          
          // Method 2: Comprehensive manual selection
          try {
            const selection = window.getSelection();
            selection.removeAllRanges();
            
            const range = document.createRange();
            
            // Find the first text node
            const walker = document.createTreeWalker(
              element,
              NodeFilter.SHOW_TEXT,
              null,
              false
            );
            
            const firstTextNode = walker.nextNode();
            const lastTextNode = this.findLastTextNode(element);
            
            if (firstTextNode && lastTextNode) {
              // Select from very beginning of first text node to end of last text node
              range.setStart(firstTextNode, 0);
              range.setEnd(lastTextNode, lastTextNode.textContent.length);
              selection.addRange(range);
              
              selectedText = selection.toString();
              if (selectedText && selectedText.length >= originalText.length * 0.9) {
                selectionSuccess = true;
                this.dbg('Manual selection worked, selected:', selectedText.length);
              }
            }
          } catch (e) {
            this.dbg('Manual selection failed:', e);
          }
        }
        
        // Method 3: If selection still failed, clear manually and skip paste event
        if (!selectionSuccess) {
          this.dbg('All selection methods failed, clearing manually');
          element.innerHTML = '';
          element.textContent = '';
          // Set flag to skip paste event and use direct replacement
          this.skipPasteEvent = true;
        } else {
          this.skipPasteEvent = false;
        }
      } else {
        // For input/textarea elements
        element.select();
        element.setSelectionRange(0, element.value.length);
        this.skipPasteEvent = false;
      }

      // Write to clipboard (modern browsers)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }

      // Use paste event only if selection worked properly
      let currentText = '';
      
      if (!this.skipPasteEvent) {
        // Create and dispatch paste event
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', text);
        clipboardData.setData('text/html', text);
        
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboardData
        });

        element.dispatchEvent(pasteEvent);

        // Check if paste event worked
        await new Promise(resolve => setTimeout(resolve, 50));
        currentText = this.getTextFromElement(element);
      }
      
      // If paste event was skipped or didn't work, use manual replacement
      if (this.skipPasteEvent || !currentText.includes(text)) {
        this.dbg('Using manual replacement due to selection issues or paste failure');
        
        // Complete manual clearing and replacement
        if (element.contentEditable === 'true' || element.contentEditable === '') {
          // Multiple clearing attempts for contenteditable
          element.innerHTML = '';
          element.textContent = '';
          
          // Force reflow
          element.offsetHeight;
          
          // Set new text
          element.textContent = text;
          
          // Verify and use innerHTML if needed
          if (element.textContent !== text) {
            element.innerHTML = text.replace(/\n/g, '<br>');
          }
        } else {
          element.value = '';
          element.value = text;
        }
        
        // Trigger events
        this.triggerInputEvents(element, text);
        currentText = text;
      }
      
      const success = currentText.trim() === text.trim() || currentText.includes(text);
      
      this.dbg('Clipboard method result:', { success, currentText: this.truncate(currentText, 100) });
      return success;

    } catch (error) {
      this.dbg('Clipboard method failed:', error);
      return false;
    }
  }

  /**
   * Method 2: execCommand (Good Compatibility)
   * Uses browser's built-in text insertion
   */
  async replaceTextWithExecCommand(element, text) {
    try {
      element.focus();
      
      // Check for Reddit-specific editors first
      const isDraftEditor = element.className?.includes('DraftEditor') || 
                           element.className?.includes('public-DraftEditor');
      const isLexicalEditor = element.getAttribute('data-lexical-editor') === 'true';
      
      if (isDraftEditor || isLexicalEditor) {
        this.dbg('execCommand - Detected Reddit editor, using specialized replacement');
        return await this.replaceTextInRedditEditor(element, text);
      }
      
      // Ensure complete text selection using the same robust method
      if (element.contentEditable === 'true' || element.contentEditable === '') {
        // Get current text to verify selection
        const originalText = this.getTextFromElement(element);
        this.dbg('execCommand - Original text to select:', this.truncate(originalText, 100));
        
        // Try selectAll first
        document.execCommand('selectAll', false, null);
        let selectedText = window.getSelection().toString();
        
        // Verify selection is complete (at least 90% of original text)
        if (!selectedText || selectedText.length < originalText.length * 0.9) {
          this.dbg('execCommand - selectAll incomplete, trying comprehensive selection');
          
          // Use the same comprehensive selection as clipboard method
          try {
            const selection = window.getSelection();
            selection.removeAllRanges();
            
            const range = document.createRange();
            
            // Find first and last text nodes
            const walker = document.createTreeWalker(
              element,
              NodeFilter.SHOW_TEXT,
              null,
              false
            );
            
            const firstTextNode = walker.nextNode();
            const lastTextNode = this.findLastTextNode(element);
            
            if (firstTextNode && lastTextNode) {
              // Select from very beginning to very end
              range.setStart(firstTextNode, 0);
              range.setEnd(lastTextNode, lastTextNode.textContent.length);
              selection.addRange(range);
              
              selectedText = selection.toString();
              this.dbg('execCommand - Manual selection result:', selectedText.length, 'chars');
            }
          } catch (e) {
            this.dbg('execCommand - Manual selection failed, will clear manually:', e);
          }
          
          // If still no proper selection, clear manually
          if (!selectedText || selectedText.length < originalText.length * 0.9) {
            this.dbg('execCommand - Clearing manually due to selection failure');
            element.innerHTML = '';
            element.textContent = '';
          }
        }
      } else {
        // For input/textarea elements
        element.select();
        element.setSelectionRange(0, element.value.length);
      }
      
      // Insert text using execCommand (preserves undo history)
      const success = document.execCommand('insertText', false, text);
      
      if (!success) {
        this.dbg('insertText failed, using manual replacement');
        
        // Manual fallback
        if (element.contentEditable === 'true' || element.contentEditable === '') {
          element.innerHTML = '';
          element.textContent = text;
        } else {
          element.value = text;
        }
      }
      
      // Always trigger events for framework compatibility
      this.triggerInputEvents(element, text);
      
      // Verify the change
      const currentText = this.getTextFromElement(element);
      const verified = currentText.trim() === text.trim();
      
      this.dbg('execCommand method result:', { success, verified, currentText: this.truncate(currentText, 100) });
      return verified; // Return based on verification, not just execCommand success

    } catch (error) {
      this.dbg('execCommand method failed:', error);
      return false;
    }
  }

  /**
   * Method 3: Direct DOM Manipulation (Last Resort)
   * Direct property setting with comprehensive event triggering
   */
  async replaceTextDirect(element, text) {
    try {
      element.focus();
      
      // Completely clear and set the text based on element type
      if (element.contentEditable === 'true' || element.contentEditable === '') {
        // For contenteditable elements - clear completely first
        element.innerHTML = '';
        element.textContent = '';
        
        // Small delay to ensure clearing is complete
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Set new text
        element.textContent = text;
        
        // For complex editors, also try innerHTML as fallback
        if (!element.textContent || element.textContent !== text) {
          element.innerHTML = text.replace(/\n/g, '<br>');
        }
      } else {
        // For input/textarea elements
        element.value = '';
        element.value = text;
      }
      
      // Trigger comprehensive events for framework compatibility
      this.triggerInputEvents(element, text);
      
      // Position cursor at the end
      this.positionCursorAtEnd(element);
      
      // Verify the change
      const currentText = this.getTextFromElement(element);
      const success = currentText.trim() === text.trim();
      
      this.dbg('Direct method result:', { success, currentText: this.truncate(currentText, 100) });
      return success;

    } catch (error) {
      this.dbg('Direct method failed:', error);
      return false;
    }
  }

  /**
   * Specialized replacement for Reddit's Draft.js and Lexical editors
   * Prefer native edit pipeline: Selection API + beforeinput(insertFromPaste)
   */
  async replaceTextInRedditEditor(element, text) {
    try {
      this.dbg('Reddit editor replacement - element:', element.className, element.getAttribute('data-lexical-editor'));
      
      const originalText = this.getTextFromElement(element);
      this.dbg('Reddit editor - original text:', this.truncate(originalText, 100));
      
      // Focus the element
      element.focus();
      
      // 0) Try native beforeinput transaction: SelectAll -> Delete -> InsertFromPaste
      try {
        const selected = this.selectAllInContentEditable(element);
        this.dbg('Reddit editor - selectAll via Selection API:', selected);
        if (selected) {
          // A) delete the current selection via beforeinput
          const delEvt = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'deleteContentBackward'
          });
          element.dispatchEvent(delEvt);
          await new Promise(r => setTimeout(r, 20));
          
          // Verify cleared (or accept partially cleared)
          const afterDelete = this.getTextFromElement(element);
          this.dbg('Reddit editor - after beforeinput delete length:', afterDelete.length);
          
          // B) now insert new text as paste
          const dt = this.createClipboardDT(text);
          const insEvt = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertFromPaste',
            data: text
          });
          try { Object.defineProperty(insEvt, 'dataTransfer', { value: dt }); } catch(_) {}
          element.dispatchEvent(insEvt);
          await new Promise(r => setTimeout(r, 30));
          const result = this.getTextFromElement(element).trim();
          if (result === String(text).trim()) {
            this.dbg('Reddit editor - beforeinput delete+paste transaction succeeded');
            return true;
          }
        }
      } catch (e) {
        this.dbg('Reddit editor - beforeinput paste path failed:', e);
      }
      
      // 1) Try a single ClipboardEvent("paste") with a proper selection
      try {
        const selected = this.selectAllInContentEditable(element);
        const dt = this.createClipboardDT(text);
        const pasteEvt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
        const ok = element.dispatchEvent(pasteEvt);
        this.dbg('Reddit editor - paste event dispatched, ok:', ok);
        await new Promise(r => setTimeout(r, 30));
        const afterPaste = this.getTextFromElement(element).trim();
        if (afterPaste === String(text).trim()) {
          this.dbg('Reddit editor - paste event path succeeded');
          return true;
        }
      } catch (e) {
        this.dbg('Reddit editor - paste path failed:', e);
      }
      
      // 2) Aggressive clearing for React editors (last resort)
      this.dbg('Reddit editor - Using aggressive React-aware clearing');
      
      // Step 1: Multiple clearing attempts for React state
      // Clear via selection first (most compatible with React)
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        this.dbg('Reddit editor - Cleared via selectAll + delete');
      } catch (e) {
        this.dbg('Reddit editor - selectAll clearing failed:', e);
      }
      
      // Step 2: DOM clearing as backup
      element.innerHTML = '';
      element.textContent = '';
      
      // Step 3: Remove all child nodes (React might recreate them)
      while (element.firstChild) {
        element.removeChild(element.firstChild);
      }
      
      // Step 4: Force multiple reflows to ensure clearing
      element.offsetHeight;
      element.offsetWidth;
      
      // Step 5: Wait a moment for React to process
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Step 6: Set new content using multiple methods
      element.textContent = text;
      
      // Step 7: Verify content was set, try alternatives if needed
      let currentText = this.getTextFromElement(element);
      if (!currentText || currentText !== text) {
        this.dbg('Reddit editor - textContent failed, trying innerHTML');
        element.innerHTML = text.replace(/\n/g, '<br>');
        currentText = this.getTextFromElement(element);
      }
      
      // Step 8: If still no content, try direct text node insertion
      if (!currentText || currentText !== text) {
        this.dbg('Reddit editor - innerHTML failed, trying text node insertion');
        element.innerHTML = '';
        const textNode = document.createTextNode(text);
        element.appendChild(textNode);
        currentText = this.getTextFromElement(element);
      }
      
      // Step 9: Trigger minimal but effective React events
      // Only trigger the essential events to avoid duplications
      const essentialEvents = [
        new InputEvent('input', { 
          bubbles: true,
          inputType: 'insertReplacementText',
          data: text
        }),
        new Event('change', { bubbles: true })
      ];
      
      // Dispatch events with small delay
      essentialEvents.forEach((event, index) => {
        setTimeout(() => {
          element.dispatchEvent(event);
        }, index * 20);
      });
      
      // Final verification
      await new Promise(resolve => setTimeout(resolve, 50));
      const finalText = this.getTextFromElement(element);
      const success = finalText.trim() === text.trim();
      
      this.dbg('Reddit editor - result:', success, 'final text:', this.truncate(finalText, 100));
      
      if (success) {
        return true;
      }
      
      // Method 2: If DOM method failed, try React state manipulation
      this.dbg('Reddit editor - Trying React state manipulation fallback');
      
      try {
        // Step 1: Try to find and manipulate React fiber
        const reactKey = Object.keys(element).find(key => key.startsWith('__reactInternalInstance') || key.startsWith('_reactInternalFiber'));
        if (reactKey) {
          this.dbg('Reddit editor - Found React fiber, attempting state manipulation');
          // Clear React's internal state if possible
          const reactInstance = element[reactKey];
          if (reactInstance && reactInstance.memoizedProps) {
            // Try to trigger React's onChange with empty value first
            if (reactInstance.memoizedProps.onChange) {
              reactInstance.memoizedProps.onChange({ target: { value: '' } });
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
        }
        
        // Step 2: Aggressive DOM clearing
        element.innerHTML = '';
        element.textContent = '';
        while (element.firstChild) {
          element.removeChild(element.firstChild);
        }
        
        // Step 3: Multiple insertion attempts
        element.focus();
        
        // Try execCommand first
        document.execCommand('selectAll', false, null);
        const insertSuccess = document.execCommand('insertText', false, text);
        
        if (insertSuccess) {
          this.dbg('Reddit editor - execCommand insertText succeeded');
        } else {
          // Fallback to direct DOM insertion
          this.dbg('Reddit editor - execCommand failed, using DOM insertion');
          const textNode = document.createTextNode(text);
          element.appendChild(textNode);
        }
        
        // Step 4: Trigger React update
        element.dispatchEvent(new InputEvent('input', { 
          bubbles: true,
          inputType: 'insertText',
          data: text
        }));
        
        await new Promise(resolve => setTimeout(resolve, 50));
        const verifyText = this.getTextFromElement(element);
        const verified = verifyText.trim() === text.trim();
        
        this.dbg('Reddit editor - fallback method result:', verified, 'text:', this.truncate(verifyText, 100));
        return verified;
        
      } catch (e) {
        this.dbg('Reddit editor - fallback method failed:', e);
      }
      
      return false;
      
    } catch (error) {
      this.dbg('Reddit editor replacement failed:', error);
      return false;
    }
  }

  /**
   * Select all text within a contentEditable using Selection API precisely.
   */
  selectAllInContentEditable(element) {
    try {
      const selection = window.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      const first = this.findFirstTextNode(element);
      const last = this.findLastTextNode(element);
      if (!first || !last) {
        // If no text nodes, select the element contents
        const r = document.createRange();
        r.selectNodeContents(element);
        selection.addRange(r);
        return true;
      }
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(last, last.textContent.length);
      selection.addRange(range);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Find first text node inside element
   */
  findFirstTextNode(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    let node = walker.nextNode();
    while (node && !node.textContent.trim()) node = walker.nextNode();
    return node;
  }

  /**
   * Create a DataTransfer with text/plain and text/html for paste/beforeinput
   */
  createClipboardDT(text) {
    const dt = new DataTransfer();
    try { dt.setData('text/plain', String(text)); } catch(_) {}
    try { dt.setData('text/html', String(text)); } catch(_) {}
    return dt;
  }

  /**
   * Helper function to find the last text node in an element
   */
  findLastTextNode(element) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let lastTextNode = null;
    let currentNode;
    
    while (currentNode = walker.nextNode()) {
      if (currentNode.textContent.trim()) {
        lastTextNode = currentNode;
      }
    }
    
    return lastTextNode;
  }

  /**
   * Trigger comprehensive input events for framework compatibility
   */
  triggerInputEvents(element, text) {
    const events = [
      // Input events (modern)
      new InputEvent('beforeinput', { 
        bubbles: true, 
        cancelable: true,
        inputType: 'insertReplacementText',
        data: text
      }),
      new InputEvent('input', { 
        bubbles: true,
        inputType: 'insertReplacementText',
        data: text
      }),
      
      // Change events (traditional)
      new Event('change', { bubbles: true }),
      
      // Focus events
      new Event('focus', { bubbles: true }),
      new Event('blur', { bubbles: true }),
      
      // React-specific events
      new CustomEvent('text-change', { 
        bubbles: true,
        detail: { value: text }
      })
    ];

    // Dispatch events with small delays for better compatibility
    events.forEach((event, index) => {
      setTimeout(() => {
        element.dispatchEvent(event);
      }, index * 5);
    });
  }

  /**
   * Position cursor at the end of text
   */
  positionCursorAtEnd(element) {
    try {
      if (element.contentEditable === 'true' || element.contentEditable === '') {
        // For contenteditable elements
        const range = document.createRange();
        const selection = window.getSelection();
        
        if (element.firstChild) {
          const textNode = element.firstChild;
          const length = textNode.textContent ? textNode.textContent.length : textNode.length;
          range.setStart(textNode, length);
          range.setEnd(textNode, length);
        } else {
          range.selectNodeContents(element);
          range.collapse(false);
        }
        
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        // For input/textarea elements
        const length = element.value.length;
        element.setSelectionRange(length, length);
      }
    } catch (error) {
      this.dbg('Could not position cursor:', error);
    }
  }

  /**
   * Fallback method for when all else fails
   */
  fallbackTextReplacement(element, text) {
    this.dbg('Using fallback text replacement');
    
    if (element.contentEditable === 'true' || element.contentEditable === '') {
      // Complete clearing for contenteditable
      element.innerHTML = '';
      element.textContent = '';
      
      // Force a reflow to ensure clearing
      element.offsetHeight;
      
      // Set new text
      element.textContent = text;
      
      // If textContent didn't work, try innerHTML
      if (!element.textContent || element.textContent !== text) {
        element.innerHTML = text.replace(/\n/g, '<br>');
      }
    } else {
      // For input/textarea
      element.value = '';
      element.value = text;
    }
    
    // Enhanced events
    const events = [
      new Event('focus', { bubbles: true }),
      new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }),
      new Event('change', { bubbles: true }),
      new Event('blur', { bubbles: true })
    ];
    
    events.forEach(event => element.dispatchEvent(event));
    
    this.positionCursorAtEnd(element);
  }

  // Specialized function for LinkedIn editors - SIMPLE & RELIABLE APPROACH
  setTextInLinkedInQuillEditor(element, text) {
    this.dbg('Setting text in LinkedIn editor - SIMPLE APPROACH');
    this.dbg('LinkedIn element details:', {
      tagName: element.tagName,
      className: element.className,
      id: element.id,
      attributes: Array.from(element.attributes).map(attr => `${attr.name}="${attr.value}"`).join(' ')
    });
    
    // SIMPLE APPROACH: Simulate exact user actions that work
    // Ctrl+A, Backspace, Ctrl+V - this is what users actually do!
    
    // Method 1: Simple keyboard simulation (most reliable)
    if (this.simulateUserTypingActions(element, text)) {
      this.dbg('User typing simulation succeeded');
      return;
    }

    // Method 2: Clipboard-based approach
    if (this.useClipboardApproach(element, text)) {
      this.dbg('Clipboard approach succeeded');
      return;
    }
    
    // Method 3: Direct text replacement with proper events
    this.directTextReplacement(element, text);
  }

  // Method 1: Simulate user typing actions (Ctrl+A, Backspace, Ctrl+V)
  simulateUserTypingActions(element, text) {
    this.dbg('Simulating user typing actions: Ctrl+A, Backspace, Ctrl+V');
    
    try {
      // Focus the element first
      element.focus();
      
      // Step 1: Ctrl+A (Select All)
      const ctrlAEvent = new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      element.dispatchEvent(ctrlAEvent);
      
      // Small delay to ensure selection
      setTimeout(() => {
        // Step 2: Backspace (Delete selected content)
        const backspaceEvent = new KeyboardEvent('keydown', {
          key: 'Backspace',
          code: 'Backspace',
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(backspaceEvent);
        
        // Small delay before paste
        setTimeout(() => {
          // Step 3: Set clipboard content and paste
          this.setClipboardContent(text);
          
          // Step 4: Ctrl+V (Paste)
          const ctrlVEvent = new KeyboardEvent('keydown', {
            key: 'v',
            code: 'KeyV',
            ctrlKey: true,
            bubbles: true,
            cancelable: true
          });
          element.dispatchEvent(ctrlVEvent);
          
          // Also trigger paste event
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: this.createClipboardData(text)
          });
          element.dispatchEvent(pasteEvent);
          
          this.dbg('User typing simulation completed');
        }, 25); // 25ms delay as requested
      }, 25); // 25ms delay as requested
      
      return true;
    } catch (e) {
      this.dbg('User typing simulation failed:', e);
      return false;
    }
  }

  // Method 2: Clipboard-based approach
  useClipboardApproach(element, text) {
    this.dbg('Using clipboard approach');
    
    try {
      // Focus and select all
      element.focus();
      document.execCommand('selectAll', false, null);
      
      // Set clipboard content
      this.setClipboardContent(text);
      
      // Paste using execCommand
      const success = document.execCommand('paste', false, null);
      
      if (success) {
        this.dbg('Clipboard approach succeeded');
        return true;
      }
      
      // Fallback: Use insertText
      document.execCommand('insertText', false, text);
      return true;
    } catch (e) {
      this.dbg('Clipboard approach failed:', e);
      return false;
    }
  }

  // Method 3: Direct text replacement with proper events
  directTextReplacement(element, text) {
    this.dbg('Using direct text replacement');
    
    try {
      // Focus the element
      element.focus();
      
      // Clear existing content
      element.innerHTML = '';
      element.textContent = text;
      
      // Trigger comprehensive events
      const events = [
        new Event('focus', { bubbles: true }),
        new Event('focusin', { bubbles: true }),
        new InputEvent('input', { 
          bubbles: true, 
          inputType: 'insertReplacementText',
          data: text
        }),
        new Event('change', { bubbles: true }),
        new Event('blur', { bubbles: true }),
        new Event('focusout', { bubbles: true })
      ];
      
      // Dispatch events with small delays
      events.forEach((event, index) => {
        setTimeout(() => {
          element.dispatchEvent(event);
        }, index * 5);
      });
      
      this.dbg('Direct text replacement completed');
    } catch (e) {
      this.dbg('Direct text replacement failed:', e);
    }
  }

  // Helper: Set clipboard content
  setClipboardContent(text) {
    try {
      // Try to use the Clipboard API if available
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
          this.dbg('Clipboard API failed, using fallback');
        });
      }
    } catch (e) {
      this.dbg('Clipboard API not available:', e);
    }
  }

  // Helper: Create clipboard data for events
  createClipboardData(text) {
    return {
      getData: (type) => {
        if (type === 'text/plain') return text;
        if (type === 'text/html') return `<p>${text}</p>`;
        return '';
      },
      setData: () => {},
      clearData: () => {},
      types: ['text/plain', 'text/html']
    };
  }

  // Method 1: Direct Quill API access (most reliable)
  setTextViaQuillAPI(element, text) {
    this.dbg('Attempting direct Quill API access');
    
    try {
      // Find Quill instance - try multiple approaches
      let quillInstance = null;
      
      // Approach 1: Check element itself for Quill instance
      if (element.__quill) {
        quillInstance = element.__quill;
        this.dbg('Found Quill instance on element itself');
      }
      
      // Approach 2: Check parent containers
      if (!quillInstance) {
        let parent = element.parentElement;
        while (parent && !quillInstance) {
          if (parent.__quill) {
            quillInstance = parent.__quill;
            this.dbg('Found Quill instance on parent element');
            break;
          }
          if (parent.classList.contains('ql-container')) {
            if (parent.__quill) {
              quillInstance = parent.__quill;
              this.dbg('Found Quill instance on ql-container');
              break;
            }
          }
          parent = parent.parentElement;
        }
      }
      
      // Approach 3: Search for Quill in global scope or window
      if (!quillInstance && typeof window.Quill !== 'undefined') {
        // Try to find the Quill instance by traversing the DOM
        const container = element.closest('.ql-container');
        if (container && container.__quill) {
          quillInstance = container.__quill;
          this.dbg('Found Quill instance via container search');
        }
      }
      
      // If we found a Quill instance, use its API
      if (quillInstance) {
        this.dbg('Using Quill API to set text');
        
        // Clear current content and set new text
        const length = quillInstance.getLength();
        quillInstance.deleteText(0, length);
        quillInstance.insertText(0, text);
        
        // Trigger change events
        quillInstance.blur();
        quillInstance.focus();
        
        // Verify the change
        const currentText = quillInstance.getText().trim();
        const expectedText = text.trim();
        const success = currentText === expectedText;
        
        this.dbg('Quill API result:', { success, currentText: this.truncate(currentText, 100) });
        return success;
      }
      
      return false;
    } catch (e) {
      this.dbg('Direct Quill API access failed:', e);
      return false;
    }
  }

  // Method 2: Enhanced clipboard simulation with proper Quill handling
  simulateQuillClipboardPaste(element, text) {
    this.dbg('Attempting Quill clipboard paste simulation');
    
    try {
      // Focus and select all content
      element.focus();
      
      // Create a more comprehensive selection
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      
      // Create clipboard event with proper data
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      clipboardData.setData('text/html', text);
      
      // Create and dispatch paste event
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboardData
      });
      
      // Dispatch the event
      const result = element.dispatchEvent(pasteEvent);
      
      // If the event wasn't handled, manually insert text
      if (!pasteEvent.defaultPrevented) {
        // Try execCommand as fallback
      document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      }
      
      // Trigger comprehensive Quill events
      this.triggerQuillEvents(element, text);
      
      // Verify the change
      setTimeout(() => {
        const currentText = (element.innerText || element.textContent || '').trim();
        const expectedText = text.trim();
        const success = currentText === expectedText || currentText.includes(expectedText);
        this.dbg('Quill clipboard paste result:', { success, currentText: this.truncate(currentText, 100) });
      }, 100);
      
      return true;
    } catch (e) {
      this.dbg('Quill clipboard paste simulation failed:', e);
      return false;
    }
  }

  // Method 3: Improved React state manipulation for LinkedIn
  setLinkedInReactStateImproved(element, text) {
    this.dbg('Attempting improved LinkedIn React state manipulation');
    
    try {
      // Multiple approaches to find and update React state
      
      // Approach 1: Find React fiber with more comprehensive search
      const reactKeys = Object.keys(element).filter(key => 
        key.startsWith('__reactInternalInstance') || 
        key.startsWith('__reactFiber') ||
        key.startsWith('_reactInternalFiber')
      );
      
      for (const key of reactKeys) {
        const fiber = element[key];
        if (fiber) {
          // Try to find state or props that control the text
          let current = fiber;
          let attempts = 0;
          
          while (current && attempts < 10) {
            // Check for state with text/value properties
            if (current.stateNode) {
              const stateNode = current.stateNode;
              
              // Try to find setValue or similar methods
              if (typeof stateNode.setValue === 'function') {
                this.dbg('Found setValue method, attempting to use it');
                stateNode.setValue(text);
                return true;
              }
              
              // Try to update state directly
              if (stateNode.state && typeof stateNode.setState === 'function') {
                this.dbg('Found setState method, attempting to update state');
                stateNode.setState({ value: text, text: text });
                return true;
              }
              
              // Check for props with onChange handlers
              if (current.memoizedProps && current.memoizedProps.onChange) {
                this.dbg('Found onChange prop, simulating change event');
                const changeEvent = {
                  target: { value: text, textContent: text },
                  currentTarget: element
                };
                current.memoizedProps.onChange(changeEvent);
                return true;
              }
            }
            
            current = current.return || current.parent;
            attempts++;
          }
        }
      }
      
      // Approach 2: Try to trigger React's synthetic event system
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLDivElement.prototype, 
        'textContent'
      ).set;
      
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(element, text);
        
        // Create synthetic React event
        const inputEvent = new Event('input', { bubbles: true });
        Object.defineProperty(inputEvent, 'target', { writable: false, value: element });
        Object.defineProperty(inputEvent, 'currentTarget', { writable: false, value: element });
        
        element.dispatchEvent(inputEvent);
        
        this.dbg('React synthetic event approach completed');
        return true;
      }
      
      return false;
    } catch (e) {
      this.dbg('Improved LinkedIn React state manipulation failed:', e);
      return false;
    }
  }

  // Method 4: Enhanced typing simulation with proper Quill events
  simulateQuillTyping(element, text) {
    this.dbg('Attempting Quill typing simulation');
    
    try {
      // Clear existing content first
      element.focus();
      document.execCommand('selectAll', false, null);
      
      // Type character by character with proper timing
      const chars = Array.from(text); // Handle unicode correctly
      let currentIndex = 0;
      
      const typeNextChar = () => {
        if (currentIndex >= chars.length) {
          this.triggerQuillEvents(element, text);
        return;
      }
        
        const char = chars[currentIndex];
        
        // Simulate keydown
        const keydownEvent = new KeyboardEvent('keydown', {
          key: char,
          code: `Key${char.toUpperCase()}`,
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(keydownEvent);
        
        // Insert the character
        document.execCommand('insertText', false, char);
        
        // Simulate keyup
        const keyupEvent = new KeyboardEvent('keyup', {
          key: char,
          code: `Key${char.toUpperCase()}`,
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(keyupEvent);
        
        // Trigger input event for this character
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: char
        });
        element.dispatchEvent(inputEvent);
        
        currentIndex++;
        
        // Continue with next character (faster timing for better UX)
        setTimeout(typeNextChar, 10);
      };
      
      typeNextChar();
      return true;
    } catch (e) {
      this.dbg('Quill typing simulation failed:', e);
      return false;
    }
  }

  // Method 5: Universal replace with Quill-specific handling
  replaceContentEditableUniversallyForQuill(element, text) {
    this.dbg('Attempting Quill-aware universal replacement');
    
    try {
      element.focus();
      
      // Create selection covering entire content
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      
      // For Quill editors, we need to handle the DOM structure carefully
      const isQuillEditor = element.classList.contains('ql-editor') || 
                           element.closest('.ql-container') !== null;
      
      if (isQuillEditor) {
        // Clear content first
        range.deleteContents();
        
        // Create proper Quill-compatible structure
        const lines = text.split('\n');
        const fragment = document.createDocumentFragment();
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const p = document.createElement('p');
          
          if (line.trim() === '') {
            // Empty line needs a <br> tag in Quill
            const br = document.createElement('br');
            p.appendChild(br);
          } else {
            // Regular text line
            p.textContent = line;
          }
          
          fragment.appendChild(p);
        }
        
        // Insert the fragment
        element.innerHTML = '';
        element.appendChild(fragment);
        
        // Position cursor at the end
        const lastP = element.lastElementChild;
        if (lastP) {
          const newRange = document.createRange();
          const lastTextNode = lastP.lastChild;
          if (lastTextNode && lastTextNode.nodeType === Node.TEXT_NODE) {
            newRange.setStart(lastTextNode, lastTextNode.textContent.length);
            newRange.setEnd(lastTextNode, lastTextNode.textContent.length);
          } else {
            newRange.setStart(lastP, lastP.childNodes.length);
            newRange.setEnd(lastP, lastP.childNodes.length);
          }
          
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      } else {
        // Standard contenteditable handling
        document.execCommand('insertText', false, text);
      }
      
      // Trigger comprehensive events
      this.triggerQuillEvents(element, text);
      
      // Verify success
      const currentText = (element.innerText || element.textContent || '').trim();
      const expectedText = text.trim();
      const success = currentText === expectedText || currentText.replace(/\s+/g, ' ') === expectedText.replace(/\s+/g, ' ');
      
      this.dbg('Quill-aware universal replacement result:', { success, currentText: this.truncate(currentText, 100) });
      return success;
    } catch (e) {
      this.dbg('Quill-aware universal replacement failed:', e);
      return false;
    }
  }

  // Method 6: Final fallback with extensive event triggering
  fallbackLinkedInTextReplacement(element, text) {
    this.dbg('Using fallback LinkedIn text replacement');
    
    try {
      // Multiple attempts with different approaches
      const attempts = [
        () => {
          element.innerHTML = '';
          element.textContent = text;
          return true;
        },
        () => {
          element.focus();
          document.execCommand('selectAll', false, null);
          return document.execCommand('insertText', false, text);
        },
        () => {
          // Character-by-character insertion
      element.innerHTML = '';
      const textNode = document.createTextNode(text);
      element.appendChild(textNode);
          return true;
        }
      ];
      
      let success = false;
      for (const attempt of attempts) {
        try {
          if (attempt()) {
            success = true;
            break;
          }
    } catch (e) {
          this.dbg('Fallback attempt failed:', e);
        }
      }
      
      // Always trigger events regardless of method used
      this.triggerQuillEvents(element, text);
      
      this.dbg('Fallback LinkedIn text replacement completed:', { success });
    } catch (e) {
      this.dbg('Fallback LinkedIn text replacement failed:', e);
    }
  }

  // Enhanced event triggering specifically for Quill editors
  triggerQuillEvents(element, text) {
    this.dbg('Triggering Quill-specific events');
    
    const events = [
      // Standard input events
      new Event('focus', { bubbles: true }),
      new InputEvent('beforeinput', { 
        bubbles: true, 
        inputType: 'insertReplacementText',
        data: text
      }),
      new InputEvent('input', { 
        bubbles: true, 
        inputType: 'insertReplacementText'
      }),
      new Event('change', { bubbles: true }),
      
      // Quill-specific events
      new CustomEvent('text-change', {
        bubbles: true,
        detail: {
          delta: { ops: [{ delete: 999999 }, { insert: text }] },
          source: 'user'
        }
      }),
      
      // Selection events
      new CustomEvent('selection-change', {
        bubbles: true,
        detail: {
          range: { index: text.length, length: 0 },
          source: 'user'
        }
      }),
      
      // Additional React/framework events
      new Event('blur', { bubbles: true }),
      new Event('focusout', { bubbles: true }),
      new Event('focusin', { bubbles: true })
    ];
    
    // Dispatch events with slight delays to simulate natural interaction
    events.forEach((event, index) => {
      setTimeout(() => {
        try {
          element.dispatchEvent(event);
        } catch (e) {
          this.dbg('Failed to dispatch event:', event.type, e);
        }
      }, index * 5);
    });
    
    // Also trigger events on parent containers
    const quillContainer = element.closest('.ql-container');
    if (quillContainer) {
      setTimeout(() => {
        try {
          quillContainer.dispatchEvent(new Event('input', { bubbles: true }));
          quillContainer.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e) {
          this.dbg('Failed to dispatch container events:', e);
        }
      }, events.length * 5);
    }
  }

  // NEW APPROACH: Method 1 - LinkedIn-specific React component manipulation
  manipulateLinkedInReactComponent(element, text) {
    this.dbg('Attempting LinkedIn React component manipulation');
    
    try {
      // Find LinkedIn's specific React components and state
      const linkedinComponents = this.findLinkedInReactComponents(element);
      
      for (const component of linkedinComponents) {
        // Try to find LinkedIn's message state management
        if (component.stateNode && component.stateNode.state) {
          const state = component.stateNode.state;
          
          // Look for LinkedIn-specific state properties
          const textProperties = ['message', 'text', 'content', 'value', 'draft', 'body'];
          for (const prop of textProperties) {
            if (state.hasOwnProperty(prop)) {
              this.dbg('Found LinkedIn state property:', prop);
              
              // Update the state
              component.stateNode.setState({ [prop]: text });
              
              // Trigger LinkedIn's internal change handlers
              this.triggerLinkedInInternalEvents(element, text);
              
              return true;
            }
          }
        }
        
        // Try to find LinkedIn's props and handlers
        if (component.memoizedProps) {
          const props = component.memoizedProps;
          
          // Look for LinkedIn-specific handlers
          const handlers = ['onMessageChange', 'onTextChange', 'onContentChange', 'onValueChange'];
          for (const handler of handlers) {
            if (typeof props[handler] === 'function') {
              this.dbg('Found LinkedIn handler:', handler);
              
              // Call the handler with the new text
              const event = {
                target: { value: text },
                currentTarget: element
              };
              props[handler](event);
              
              return true;
            }
          }
        }
      }
      
      return false;
    } catch (e) {
      this.dbg('LinkedIn React component manipulation failed:', e);
      return false;
    }
  }

  // Find LinkedIn-specific React components
  findLinkedInReactComponents(element) {
    const components = [];
    
    // Search for React fiber keys specific to LinkedIn
    const reactKeys = Object.keys(element).filter(key => 
      key.startsWith('__reactInternalInstance') || 
      key.startsWith('__reactFiber') ||
      key.startsWith('_reactInternalFiber')
    );
    
    for (const key of reactKeys) {
      const fiber = element[key];
      if (fiber) {
        components.push(fiber);
        
        // Also check parent components
        let current = fiber.return;
        let depth = 0;
        while (current && depth < 5) {
          components.push(current);
          current = current.return;
          depth++;
        }
      }
    }
    
    // Also search parent elements
    let parent = element.parentElement;
    while (parent && components.length < 10) {
      const parentKeys = Object.keys(parent).filter(key => 
        key.startsWith('__reactInternalInstance') || 
        key.startsWith('__reactFiber')
      );
      
      for (const key of parentKeys) {
        if (parent[key]) {
          components.push(parent[key]);
        }
      }
      
      parent = parent.parentElement;
    }
    
    return components;
  }

  // Method 2 - LinkedIn event system integration
  integrateWithLinkedInEventSystem(element, text) {
    this.dbg('Attempting LinkedIn event system integration');
    
    try {
      // Find LinkedIn's event listeners
      const linkedinEventListeners = this.findLinkedInEventListeners(element);
      
      // Create a comprehensive event that LinkedIn will recognize
      const linkedinEvent = this.createLinkedInCompatibleEvent(element, text);
      
      // Dispatch to all relevant listeners
      for (const listener of linkedinEventListeners) {
        try {
          listener.handleEvent(linkedinEvent);
        } catch (e) {
          this.dbg('Event listener failed:', e);
        }
      }
      
      // Also dispatch to the element itself
      element.dispatchEvent(linkedinEvent);
      
      return true;
    } catch (e) {
      this.dbg('LinkedIn event system integration failed:', e);
      return false;
    }
  }

  // Find LinkedIn event listeners
  findLinkedInEventListeners(element) {
    const listeners = [];
    
    // Check for LinkedIn-specific event properties
    const eventProps = ['onInput', 'onChange', 'onTextChange', 'onMessageChange'];
    
    // Search element and parents for event handlers
    let current = element;
    while (current && listeners.length < 5) {
      for (const prop of eventProps) {
        if (current[prop] && typeof current[prop] === 'function') {
          listeners.push({ handleEvent: current[prop] });
        }
      }
      current = current.parentElement;
    }
    
    return listeners;
  }

  // Create LinkedIn-compatible event
  createLinkedInCompatibleEvent(element, text) {
    // Create a comprehensive event that mimics LinkedIn's internal events
    const event = new CustomEvent('linkedin-text-change', {
      bubbles: true,
      cancelable: true,
      detail: {
        text: text,
        source: 'extension',
        timestamp: Date.now(),
        element: element
      }
    });
    
    // Add LinkedIn-specific properties
    Object.defineProperty(event, 'target', { 
      writable: false, 
      value: element 
    });
    Object.defineProperty(event, 'currentTarget', { 
      writable: false, 
      value: element 
    });
    Object.defineProperty(event, 'value', { 
      writable: false, 
      value: text 
    });
    Object.defineProperty(event, 'textContent', { 
      writable: false, 
      value: text 
    });
    
    return event;
  }

  // Method 3 - LinkedIn DOM mutation observer approach
  useLinkedInMutationObserver(element, text) {
    this.dbg('Attempting LinkedIn mutation observer approach');
    
    try {
      // Set up a mutation observer to watch for LinkedIn's changes
      const observer = new MutationObserver((mutations) => {
        this.dbg('LinkedIn DOM mutations detected:', mutations.length);
      });
      
      // Start observing
      observer.observe(element, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      });
      
      // Make the change
      element.focus();
      element.innerHTML = '';
      element.textContent = text;
      
      // Trigger LinkedIn's internal change detection
      this.triggerLinkedInInternalEvents(element, text);
      
      // Stop observing after a short delay
      setTimeout(() => {
        observer.disconnect();
      }, 1000);
      
      return true;
    } catch (e) {
      this.dbg('LinkedIn mutation observer approach failed:', e);
      return false;
    }
  }

  // Method 4 - LinkedIn clipboard integration
  integrateWithLinkedInClipboard(element, text) {
    this.dbg('Attempting LinkedIn clipboard integration');
    
    try {
      // Focus and select all content
      element.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      
      // Create a more sophisticated clipboard event
      const clipboardData = {
        getData: (type) => {
          if (type === 'text/plain') return text;
          if (type === 'text/html') return `<p>${text}</p>`;
          return '';
        },
        setData: () => {},
        clearData: () => {},
        types: ['text/plain', 'text/html']
      };
      
      // Create paste event with LinkedIn-specific properties
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboardData
      });
      
      // Add LinkedIn-specific properties to the event
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: clipboardData,
        writable: false
      });
      
      // Dispatch the event
      const handled = element.dispatchEvent(pasteEvent);
      
      // If not handled, use execCommand
      if (!handled) {
        document.execCommand('insertText', false, text);
      }
      
      // Trigger LinkedIn's internal events
      this.triggerLinkedInInternalEvents(element, text);
      
      return true;
    } catch (e) {
      this.dbg('LinkedIn clipboard integration failed:', e);
      return false;
    }
  }

  // Method 5 - LinkedIn keyboard event simulation
  simulateLinkedInKeyboardEvents(element, text) {
    this.dbg('Attempting LinkedIn keyboard event simulation');
    
    try {
      element.focus();
      
      // Clear existing content
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      
      // Simulate typing with LinkedIn-specific events
      const chars = Array.from(text);
      let index = 0;
      
      const typeNextChar = () => {
        if (index >= chars.length) {
          this.triggerLinkedInInternalEvents(element, text);
          return;
        }
        
        const char = chars[index];
        
        // Create LinkedIn-compatible keyboard events
        const keydownEvent = new KeyboardEvent('keydown', {
          key: char,
          code: `Key${char.toUpperCase()}`,
          keyCode: char.charCodeAt(0),
          which: char.charCodeAt(0),
          bubbles: true,
          cancelable: true,
          composed: true
        });
        
        const keypressEvent = new KeyboardEvent('keypress', {
          key: char,
          code: `Key${char.toUpperCase()}`,
          keyCode: char.charCodeAt(0),
          which: char.charCodeAt(0),
          bubbles: true,
          cancelable: true,
          composed: true
        });
        
        const keyupEvent = new KeyboardEvent('keyup', {
          key: char,
          code: `Key${char.toUpperCase()}`,
          keyCode: char.charCodeAt(0),
          which: char.charCodeAt(0),
          bubbles: true,
          cancelable: true,
          composed: true
        });
        
        // Dispatch events in sequence
        element.dispatchEvent(keydownEvent);
        element.dispatchEvent(keypressEvent);
        
        // Insert the character
        document.execCommand('insertText', false, char);
        
        element.dispatchEvent(keyupEvent);
        
        // Create input event
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: char,
          composed: true
        });
        element.dispatchEvent(inputEvent);
        
        index++;
        setTimeout(typeNextChar, 20); // Slower for more realistic typing
      };
      
      typeNextChar();
      return true;
    } catch (e) {
      this.dbg('LinkedIn keyboard event simulation failed:', e);
      return false;
    }
  }

  // Method 6 - LinkedIn focus/selection approach
  useLinkedInFocusSelection(element, text) {
    this.dbg('Attempting LinkedIn focus/selection approach');
    
    try {
      // Focus the element
      element.focus();
      
      // Create a comprehensive selection
      const selection = window.getSelection();
      const range = document.createRange();
      
      // Select all content
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      
      // Create beforeinput event
      const beforeInputEvent = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertReplacementText',
        data: text,
        composed: true
      });
      
      element.dispatchEvent(beforeInputEvent);
      
      // If not prevented, make the change
      if (!beforeInputEvent.defaultPrevented) {
        // Use execCommand for the actual replacement
        document.execCommand('insertText', false, text);
        
        // Create afterinput event
        const afterInputEvent = new InputEvent('input', {
          bubbles: true,
          inputType: 'insertReplacementText',
          data: text,
          composed: true
        });
        
        element.dispatchEvent(afterInputEvent);
      }
      
      // Trigger LinkedIn's internal events
      this.triggerLinkedInInternalEvents(element, text);
      
      return true;
    } catch (e) {
      this.dbg('LinkedIn focus/selection approach failed:', e);
      return false;
    }
  }

  // Method 7 - LinkedIn native browser API approach
  useLinkedInNativeBrowserAPI(element, text) {
    this.dbg('Using LinkedIn native browser API approach');
    
    try {
      // Multiple native approaches
      const approaches = [
        () => {
          // Approach 1: Direct textContent manipulation
          element.textContent = text;
          return true;
        },
        () => {
          // Approach 2: innerHTML manipulation
          element.innerHTML = `<p>${text}</p>`;
          return true;
        },
        () => {
          // Approach 3: execCommand with selectAll
          element.focus();
          document.execCommand('selectAll', false, null);
          return document.execCommand('insertText', false, text);
        },
        () => {
          // Approach 4: Range-based replacement
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(element);
          selection.removeAllRanges();
          selection.addRange(range);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          return true;
        }
      ];
      
      let success = false;
      for (const approach of approaches) {
        try {
          if (approach()) {
            success = true;
            break;
          }
        } catch (e) {
          this.dbg('Native approach failed:', e);
        }
      }
      
      // Always trigger LinkedIn events
      this.triggerLinkedInInternalEvents(element, text);
      
      return success;
    } catch (e) {
      this.dbg('LinkedIn native browser API approach failed:', e);
      return false;
    }
  }

  // Trigger LinkedIn's internal events
  triggerLinkedInInternalEvents(element, text) {
    this.dbg('Triggering LinkedIn internal events');
    
    const events = [
      // Standard events
      new Event('focus', { bubbles: true }),
      new Event('focusin', { bubbles: true }),
      new InputEvent('input', { 
        bubbles: true, 
        inputType: 'insertReplacementText',
        data: text
      }),
      new Event('change', { bubbles: true }),
      
      // LinkedIn-specific events
      new CustomEvent('linkedin-message-change', {
        bubbles: true,
        detail: { text: text, source: 'extension' }
      }),
      new CustomEvent('linkedin-text-update', {
        bubbles: true,
        detail: { text: text, source: 'extension' }
      }),
      
      // React synthetic events
      new Event('blur', { bubbles: true }),
      new Event('focusout', { bubbles: true })
    ];
    
    // Dispatch events with delays
    events.forEach((event, index) => {
      setTimeout(() => {
        try {
          element.dispatchEvent(event);
        } catch (e) {
          this.dbg('Failed to dispatch LinkedIn event:', event.type, e);
        }
      }, index * 10);
    });
    
    // Also trigger on parent containers
    const linkedinContainer = element.closest('[class*="msg-form"], [class*="message"], [class*="compose"]');
    if (linkedinContainer) {
      setTimeout(() => {
        try {
          linkedinContainer.dispatchEvent(new Event('input', { bubbles: true }));
          linkedinContainer.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e) {
          this.dbg('Failed to dispatch container events:', e);
        }
      }, events.length * 10);
    }
  }

  // Trigger comprehensive events for LinkedIn Quill editor
  triggerLinkedInEvents(element) {
    const events = [
      // Focus events
      new Event('focus', { bubbles: true, cancelable: true }),
      new Event('focusin', { bubbles: true, cancelable: true }),
      
      // Input events
      new InputEvent('beforeinput', { 
        bubbles: true, 
        cancelable: true,
        inputType: 'insertText',
        data: element.textContent
      }),
      new InputEvent('input', { 
        bubbles: true, 
        cancelable: true,
        inputType: 'insertText'
      }),
      
      // Change events
      new Event('change', { bubbles: true, cancelable: true }),
      
      // Quill-specific events
      new CustomEvent('text-change', { 
        bubbles: true,
        detail: { 
          delta: { ops: [{ insert: element.textContent }] },
          source: 'user'
        }
      }),
      
      // Keyboard events (to simulate user interaction)
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true }),
      new KeyboardEvent('keyup', { bubbles: true, cancelable: true }),
      
      // Composition events (for international input)
      new CompositionEvent('compositionstart', { bubbles: true }),
      new CompositionEvent('compositionupdate', { bubbles: true, data: element.textContent }),
      new CompositionEvent('compositionend', { bubbles: true, data: element.textContent })
    ];
    
    // Dispatch events with small delays to simulate natural input
    events.forEach((event, index) => {
      setTimeout(() => {
        element.dispatchEvent(event);
        this.dbg(`Dispatched event: ${event.type}`);
      }, index * 10);
    });
    
    // Also trigger events on parent elements that might be listening
    const quillContainer = element.closest('.ql-container');
    const messageBox = element.closest('[data-test-ql-editor-contenteditable]');
    
    if (quillContainer) {
      setTimeout(() => {
        quillContainer.dispatchEvent(new Event('input', { bubbles: true }));
      }, events.length * 10);
    }
    
    if (messageBox) {
      setTimeout(() => {
        messageBox.dispatchEvent(new Event('input', { bubbles: true }));
      }, (events.length + 1) * 10);
    }
  }

  // Universal contentEditable replacement using Selection/Range + execCommand
  replaceContentEditableUniversally(element, text) {
    try {
      // Ensure focus
      element.focus();

      // Create selection covering the whole editor
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);

      // Fire beforeinput to signal a replacement
      try {
        const beforeEvt = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertReplacementText',
          data: text
        });
        element.dispatchEvent(beforeEvt);
      } catch (_) {}

      // Try execCommand first (fast, native editing)
      let replaced = false;
      try {
        replaced = document.execCommand('insertText', false, text);
      } catch (_) {}

      // If execCommand failed, replace via DOM operations
      if (!replaced) {
        range.deleteContents();

        // For Quill editors, use paragraph structure per line
        const isQuill = element.className?.includes('ql-editor');
        if (isQuill) {
          const lines = String(text).split(/\n/);
          const frag = document.createDocumentFragment();
          for (const line of lines) {
            const p = document.createElement('p');
            if (line.length === 0) {
              const br = document.createElement('br');
              p.appendChild(br);
            } else {
              p.textContent = line;
            }
            frag.appendChild(p);
          }
          element.innerHTML = '';
          element.appendChild(frag);
          replaced = true;
        } else {
          const node = document.createTextNode(text);
          range.insertNode(node);
          // Collapse selection to end
          selection.removeAllRanges();
          const endRange = document.createRange();
          endRange.setStartAfter(node);
          endRange.setEndAfter(node);
          selection.addRange(endRange);
          replaced = true;
        }
      }

      // Dispatch input/change events so frameworks update state
      try {
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertReplacementText',
          data: text
        }));
      } catch (_) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
      this.triggerLinkedInEvents(element);

      // Verify change took effect
      const current = (element.innerText || element.textContent || '').replace(/\u200B/g, '').trim();
      const expected = String(text).trim();
      const ok = current === expected || current.replace(/\s+/g, ' ') === expected.replace(/\s+/g, ' ');
      this.dbg('Universal replace verification:', { ok, currentPreview: this.truncate(current, 120) });
      return ok;
    } catch (e) {
      this.dbg('Universal Range replacement failed:', e);
      return false;
    }
  }

  // LinkedIn React state manipulation (Method 1)
  setLinkedInReactState(element, text) {
    this.dbg('Attempting LinkedIn React state manipulation');
    
    try {
      // Try to find React fiber on the element
      const reactFiberKey = Object.keys(element).find(key => key.startsWith('__reactInternalInstance') || key.startsWith('__reactFiber'));
      
      if (reactFiberKey) {
        const fiber = element[reactFiberKey];
        this.dbg('Found React fiber:', !!fiber);
        
        // Try to find the component with state
        let currentFiber = fiber;
        while (currentFiber) {
          if (currentFiber.stateNode && currentFiber.stateNode.setState) {
            this.dbg('Found React component with setState');
            // Try to update state
            currentFiber.stateNode.setState({ value: text });
            break;
          }
          currentFiber = currentFiber.return || currentFiber._owner;
        }
      }
      
      // Try alternative React detection methods
      const reactEventHandlers = Object.keys(element).filter(key => key.startsWith('__reactEventHandlers'));
      if (reactEventHandlers.length > 0) {
        this.dbg('Found React event handlers');
      }
      
      // Try to access Quill instance directly
      if (element.closest('.ql-container')) {
        const quillContainer = element.closest('.ql-container');
        if (quillContainer.__quill) {
          this.dbg('Found Quill instance, setting text');
          quillContainer.__quill.setText(text);
          return true;
        }
        
        // Try to find Quill in parent elements
        let parent = element.parentElement;
        while (parent) {
          if (parent.__quill) {
            this.dbg('Found Quill instance on parent, setting text');
            parent.__quill.setText(text);
            return true;
          }
          parent = parent.parentElement;
        }
      }
      
      return false;
    } catch (e) {
      this.dbg('LinkedIn React state manipulation failed:', e);
      return false;
    }
  }

  // React-style input simulation (Method 2)
  simulateReactInput(element, text) {
    this.dbg('Attempting React-style input simulation');
    
    try {
      // Focus the element
      element.focus();
      
      // Clear existing content
      element.innerHTML = '';
      
      // Set the text content
      element.textContent = text;
      
      // Create a comprehensive set of React-compatible events
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLDivElement.prototype, 'textContent').set;
      nativeInputValueSetter.call(element, text);
      
      // Trigger React synthetic events
      const inputEvent = new Event('input', { bubbles: true });
      Object.defineProperty(inputEvent, 'target', { writable: false, value: element });
      Object.defineProperty(inputEvent, 'currentTarget', { writable: false, value: element });
      
      element.dispatchEvent(inputEvent);
      
      // Also trigger change event
      const changeEvent = new Event('change', { bubbles: true });
      element.dispatchEvent(changeEvent);
      
      // Trigger React-specific events
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      element.dispatchEvent(new Event('focus', { bubbles: true }));
      
      return true;
    } catch (e) {
      this.dbg('React input simulation failed:', e);
      return false;
    }
  }

  // Clipboard paste simulation (Method 2)
  simulateClipboardPaste(element, text) {
    this.dbg('Attempting clipboard paste simulation');
    
    try {
      // Focus the element
      element.focus();
      
      // Select all existing content
      document.execCommand('selectAll', false, null);
      
      // Create clipboard event with defined clipboardData
      let pasteEvent;
      try {
        pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(pasteEvent, 'clipboardData', {
          value: new DataTransfer(),
          writable: false
        });
        pasteEvent.clipboardData.setData('text/plain', text);
        pasteEvent.clipboardData.setData('text/html', text);
      } catch (_) {
        // Fallback for browsers that disallow ClipboardEvent construction
        const evt = document.createEvent('Event');
        evt.initEvent('paste', true, true);
        pasteEvent = evt;
      }
      
      // Dispatch paste event
      element.dispatchEvent(pasteEvent);
      
      // If paste event was not handled, fall back to manual insertion
      if (!pasteEvent.defaultPrevented) {
        document.execCommand('insertText', false, text);
      }
      
      // Trigger additional events
      element.dispatchEvent(new InputEvent('input', { 
        bubbles: true, 
        inputType: 'insertFromPaste',
        data: text
      }));
      
      return true;
    } catch (e) {
      this.dbg('Clipboard paste simulation failed:', e);
      return false;
    }
  }

  // Simulate natural typing for LinkedIn (ultimate fallback)
  simulateTypingInLinkedIn(element, text) {
    this.dbg('Simulating natural typing in LinkedIn');
    
    // Clear the element first
    element.innerHTML = '';
    element.focus();
    
    // Type each character with a small delay
    let currentText = '';
    const characters = text.split('');
    
    characters.forEach((char, index) => {
      setTimeout(() => {
        currentText += char;
        
        // Use execCommand to insert each character
        document.execCommand('insertText', false, char);
        
        // Trigger input event after each character
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: char
        });
        element.dispatchEvent(inputEvent);
        
        // Trigger final events after last character
        if (index === characters.length - 1) {
          setTimeout(() => {
            this.triggerLinkedInEvents(element);
          }, 50);
        }
      }, index * 20); // 20ms delay between characters
    });
  }

  extractConversationHistory() {
    const conversation = [];
    const maxTokens = 2000;
    let currentTokens = 0;

    // Debug: start log group
    this.dbgGroup('Scanning conversation history');
    
    // Detect if we're on Reddit
    const isReddit = window.location.hostname.includes('reddit.com');
    this.dbg('Platform detected - Reddit:', isReddit);

    // Reddit-specific selectors
    const redditSelectors = [
      // Comments in thread
      '[data-testid="comment"]',
      '.Comment',
      '.thing.comment',
      'div[id^="t1_"]', // Reddit comment IDs
      '.usertext-body',
      '[data-click-id="text"]',
      // Post content
      '[data-test-id="post-content"]',
      '.Post',
      'div[id^="t3_"]', // Reddit post IDs
      // New Reddit selectors
      'div[style*="max-height"][tabindex]',
      '[data-scroller-first]',
      '[data-scroller-last]'
    ];

    // Common selectors for chat messages
    const messageSelectors = isReddit ? redditSelectors : [
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
    const processedElements = new Set(); // Avoid duplicates
    
    for (const selector of messageSelectors) {
      const elements = document.querySelectorAll(selector);
      this.dbg(`Selector '${selector}' found ${elements.length} elements`);
      
      elements.forEach(el => {
        // Skip if already processed
        if (processedElements.has(el)) return;
        processedElements.add(el);
        
        // Skip elements that are likely to contain images or visual content
        if (this.isImageOrVisualElement(el)) {
          this.dbg('Skipped visual element:', el.className);
          return;
        }
        
        const text = this.extractMessageText(el);
        if (text && text.trim() && text.trim().length > 10) { // Skip very short texts
          // Additional filtering to avoid image/UI elements
          const cleanText = text.trim();
          
          // Skip elements that look like image placeholders or UI elements
          const isImageOrUI = 
            cleanText.match(/^(Activate to view larger image|Image|Photo|Picture|Loading|Your document is loading)/i) ||
            cleanText.match(/^(Like|Comment|Share|Repost|Send|Apply|View)$/i) ||
            cleanText.match(/^\d+\s+(likes?|comments?|shares?|reposts?)\s*$/i) ||
            cleanText.match(/^(Promoted|Sponsored|hashtag|…more)$/i) ||
            cleanText.match(/^\s*•\s*Following\s*$/i) ||
            cleanText.length < 15; // Very short content is likely UI
            
          if (!isImageOrUI) {
            const message = {
              element: el,
              text: cleanText,
              timestamp: this.extractTimestamp(el),
              author: this.extractAuthor(el)
            };
            messages.push(message);
            
            this.dbg('Found message:', {
              selector,
              textPreview: this.truncate(message.text, 100),
              author: message.author
            });
          } else {
            this.dbg('Skipped image/UI element:', this.truncate(cleanText, 50));
          }
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
    // Reddit-specific text extraction
    if (window.location.hostname.includes('reddit.com')) {
      // For Reddit comments/posts
      const redditTextSelectors = [
        '.md',  // Markdown content
        '.usertext-body',
        '[data-click-id="text"]',
        'div[data-testid="comment"]',
        'p' // Paragraph tags in comments
      ];
      
      for (const selector of redditTextSelectors) {
        const textEl = selector === element.tagName.toLowerCase() ? 
                       element : element.querySelector(selector);
        if (textEl) {
          const text = textEl.innerText || textEl.textContent || '';
          if (text.trim()) {
            this.dbg('Reddit text extracted via:', selector, 'length:', text.length);
            return this.cleanExtractedText(text);
          }
        }
      }
    }
    
    // LinkedIn-specific text extraction
    if (window.location.hostname.includes('linkedin.com')) {
      const linkedinTextSelectors = [
        '.feed-shared-text',
        '.feed-shared-update-v2__description-wrapper .break-words',
        '.update-components-text .break-words span[dir="ltr"]',
        '.feed-shared-text__text-view span[dir="ltr"]',
        '.comment-text span[dir="ltr"]',
        '.comments-comment-texteditor .ql-editor',
        '.feed-shared-text .break-words',
        '.update-components-text',
        '.comment-text',
        '.share-creation-state__text-editor .ql-editor'
      ];
      
      for (const selector of linkedinTextSelectors) {
        const textEl = element.querySelector(selector);
        if (textEl) {
          const text = textEl.innerText || textEl.textContent || '';
          if (text.trim()) {
            this.dbg('LinkedIn text extracted via:', selector, 'length:', text.length);
            return this.cleanExtractedText(text);
          }
        }
      }
    }
    
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
        return this.cleanExtractedText(text);
      }
    }

    // Fallback to element's own text, but clean it first
    const fallback = element.innerText || element.textContent || '';
    try {
      console.debug?.('[ChatRefinement] extracted via fallback', '→', fallback.length, 'chars');
    } catch (_) {}
    return this.cleanExtractedText(fallback);
  }

  // New function to clean extracted text from images and excessive whitespace
  cleanExtractedText(text) {
    if (!text) return '';
    
    // Remove excessive whitespace and normalize line breaks
    let cleaned = text
      .replace(/\s+/g, ' ')  // Replace multiple whitespace with single space
      .replace(/\n\s*\n\s*\n/g, '\n\n')  // Normalize multiple line breaks to max 2
      .trim();
    
    // Remove common image/UI-related text patterns that create noise
    const imagePatterns = [
      /^(Activate to view larger image,?\s*)+/gi,
      /^(Image\s*)+/gi,
      /^(Photo\s*)+/gi,
      /^(Picture\s*)+/gi,
      /^(Graphic\s*)+/gi,
      /^(Chart\s*)+/gi,
      /^(Diagram\s*)+/gi,
      /^\s*(View|Show|Open|Click)\s+(image|photo|picture|graphic|chart|diagram)/gi,
      /^\s*Loading\.\.\.\s*/gi,
      /^\s*Your document is loading\s*/gi,
      /^\s*\d+\s+(likes?|comments?|shares?|reposts?)\s*/gi,
      /^\s*(Like|Comment|Share|Repost|Send)\s*$/gi,
      /^\s*•\s*Following\s*/gi,
      /^\s*Promoted\s*/gi,
      /^\s*Sponsored\s*/gi,
      /^\s*hashtag\s*/gi,
      /^\s*…more\s*/gi,
      /^\s*Apply\.\s*View Sponsored Content\s*/gi,
      /^\s*\d+\s+(hour|day|week|month|year)s?\s+ago\s*/gi
    ];
    
    // Apply pattern filtering
    for (const pattern of imagePatterns) {
      cleaned = cleaned.replace(pattern, '');
    }
    
    // Remove lines that are mostly whitespace or very short non-meaningful content
    const lines = cleaned.split('\n');
    const meaningfulLines = lines.filter(line => {
      const trimmedLine = line.trim();
      // Keep lines that have substantial content (more than just UI elements)
      return trimmedLine.length > 10 && 
             !trimmedLine.match(/^[\s\-_•]+$/) && // Not just punctuation/whitespace
             !trimmedLine.match(/^\d+$/) && // Not just numbers
             !trimmedLine.match(/^(Like|Comment|Share|Repost|Send|Apply|View|Show|Open|Click)$/i);
    });
    
    cleaned = meaningfulLines.join('\n').trim();
    
    // Final cleanup - remove excessive spaces again after processing
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    this.dbg('Text cleaning: original length:', text.length, 'cleaned length:', cleaned.length);
    
    return cleaned;
  }

  // Check if an element is likely to contain images or visual content
  isImageOrVisualElement(element) {
    if (!element) return false;
    
    const className = element.className || '';
    const tagName = element.tagName?.toLowerCase() || '';
    
    // Check for image-related class names
    const imageClasses = [
      'image', 'img', 'photo', 'picture', 'graphic', 'chart', 'diagram',
      'visual', 'media', 'carousel', 'gallery', 'thumbnail', 'preview',
      'poster', 'banner', 'hero', 'cover', 'artwork', 'illustration'
    ];
    
    const hasImageClass = imageClasses.some(cls => 
      className.toLowerCase().includes(cls)
    );
    
    // Check for image tags or elements that commonly contain images
    const isImageTag = ['img', 'picture', 'figure', 'canvas', 'svg'].includes(tagName);
    
    // Check for elements that have image-related attributes
    const hasImageAttributes = 
      element.hasAttribute('src') ||
      element.hasAttribute('data-src') ||
      element.hasAttribute('background-image') ||
      element.style.backgroundImage;
    
    // Check if element contains mostly images (more img tags than text content)
    const imgTags = element.querySelectorAll('img, picture, figure, canvas, svg');
    const textContent = (element.textContent || '').trim();
    const hasMoreImagesThanText = imgTags.length > 0 && textContent.length < 50;
    
    // LinkedIn-specific visual element classes
    const linkedinVisualClasses = [
      'feed-shared-image',
      'feed-shared-media',
      'feed-shared-carousel',
      'feed-shared-video',
      'update-components-image',
      'update-components-video',
      'artdeco-card-image',
      'feed-shared-article-image'
    ];
    
    const hasLinkedInVisualClass = linkedinVisualClasses.some(cls => 
      className.includes(cls)
    );
    
    return hasImageClass || isImageTag || hasImageAttributes || hasMoreImagesThanText || hasLinkedInVisualClass;
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

  // Extract author name from element (Reddit-specific)
  extractAuthor(element) {
    if (!window.location.hostname.includes('reddit.com')) return null;
    
    const authorSelectors = [
      'a[data-testid="comment_author_link"]',
      'a[data-testid="post_author_link"]',
      '.author',
      'a[href*="/user/"]',
      '[data-author]'
    ];
    
    for (const selector of authorSelectors) {
      const authorEl = element.querySelector(selector);
      if (authorEl) {
        const author = authorEl.textContent?.trim() || 
                      authorEl.getAttribute('data-author') || 
                      authorEl.href?.split('/user/')[1]?.split(/[/?]/)[0];
        if (author) {
          this.dbg('Author found:', author);
          return author;
        }
      }
    }
    
    return null;
  }

  isFromUser(element) {
    // Reddit-specific: check if comment is from current user
    if (window.location.hostname.includes('reddit.com')) {
      // Check for edit button (only appears on user's own comments)
      const hasEditButton = element.querySelector('.edit-usertext') || 
                           element.querySelector('[data-test-id="comment-edit-button"]');
      if (hasEditButton) {
        this.dbg('Message identified as from user (has edit button)');
        return true;
      }
      
      // Check username match
      const currentUserEl = document.querySelector('.user a.user') || 
                           document.querySelector('[data-testid="user-drawer-username"]');
      const currentUser = currentUserEl?.textContent?.trim();
      const messageAuthor = this.extractAuthor(element);
      
      if (currentUser && messageAuthor && currentUser === messageAuthor) {
        this.dbg('Message identified as from user (username match):', currentUser);
        return true;
      }
    }
    
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
    
    // Focus the panel itself for keyboard events
    setTimeout(() => {
      // Set tabindex to make panel focusable
      panel.setAttribute('tabindex', '-1');
      panel.focus();
      this.dbg('Panel focused for keyboard shortcuts');
    }, 10);
    
    // Add event listeners
    this.attachMinimalReplacementListeners();
    
    // Focus management to ensure keyboard shortcuts work
    this.replacementPanel.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Prevent bubbling to avoid conflicts
    });
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
  async applyAll() {
    console.log('[REPLACEMENT] Applying all changes');
    this.dbg('applyAll called with:', {
      hasTextArea: !!this.currentTextArea,
      refinedTextLength: this.refinedText?.length,
      elementType: this.currentTextArea?.tagName,
      elementClass: this.currentTextArea?.className
    });
    
    if (this.currentTextArea && this.refinedText) {
      // Store original for debugging
      const originalContent = this.getTextFromElement(this.currentTextArea);
      this.dbg('Original content before replace:', this.truncate(originalContent, 100));
      
      await this.setTextInElement(this.currentTextArea, this.refinedText);
      
      // Verify the change
      setTimeout(() => {
        const newContent = this.getTextFromElement(this.currentTextArea);
        this.dbg('Content after replace:', this.truncate(newContent, 100));
        
        if (newContent === this.refinedText) {
          this.showNotification('✓ Changes applied', 'success');
        } else {
          this.dbg('WARNING: Content mismatch after setting!');
          this.dbg('Expected:', this.truncate(this.refinedText, 100));
          this.dbg('Got:', this.truncate(newContent, 100));
        }
        
        this.restoreSelection(null, 0);
      }, 50);
    } else {
      this.dbg('ERROR: Missing currentTextArea or refinedText');
    }
    
    this.hideReplacementPanel();
  }

  // Cancel replacement and restore original
  async cancelReplacement() {
    console.log('[REPLACEMENT] Cancelling replacement');
    
    if (this.currentTextArea && this.originalText) {
      await this.setTextInElement(this.currentTextArea, this.originalText);
      
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

    const overlayElement = this.replacementPanel.querySelector('.ultra-minimal-overlay');
    overlayElement.style.position = 'fixed'; // Use fixed positioning to avoid scroll issues
    overlayElement.style.zIndex = '10002';
    
    // Position directly above the text area (using viewport-relative coordinates)
    const topPosition = Math.max(10, rect.top - 120);
    const leftPosition = rect.left;
    
    overlayElement.style.top = `${topPosition}px`;
    overlayElement.style.left = `${leftPosition}px`;
    
    console.log('[REPLACEMENT] Positioned at:', { topPosition, leftPosition, rect });
    
    // Ensure it doesn't go off-screen horizontally
    const panelWidth = 400;
    const viewportWidth = window.innerWidth;
    
    if (leftPosition + panelWidth > viewportWidth - 10) {
      const adjustedLeft = Math.max(10, viewportWidth - panelWidth - 10);
      overlayElement.style.left = `${adjustedLeft}px`;
      console.log('[REPLACEMENT] Adjusted left position to:', adjustedLeft);
    }
    
    // Ensure it doesn't go off-screen vertically
    if (topPosition < 10) {
      // If it would go above the viewport, position it below the text area instead
      const bottomPosition = rect.bottom + 10;
      overlayElement.style.top = `${bottomPosition}px`;
      console.log('[REPLACEMENT] Positioned below text area at:', bottomPosition);
    }
    
    // Also ensure it doesn't go below viewport
    const viewportHeight = window.innerHeight;
    const panelHeight = 150; // Approximate height
    if (parseFloat(overlayElement.style.top) + panelHeight > viewportHeight - 10) {
      const adjustedTop = Math.max(10, viewportHeight - panelHeight - 10);
      overlayElement.style.top = `${adjustedTop}px`;
      console.log('[REPLACEMENT] Adjusted to fit within viewport height:', adjustedTop);
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
      
      console.log('[REPLACEMENT] Key pressed:', e.key, 'Target:', e.target.tagName, e.target.id);
      
      // Don't handle if user is typing in an input field (except our panel buttons)
      const isInPanel = this.replacementPanel.contains(e.target);
      const isButton = e.target.tagName === 'BUTTON';
      
      if (!isInPanel && !isButton) {
        this.dbg('Key event not from panel, ignoring');
        // Still allow keyboard shortcuts from outside
      }
      
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation(); // Stop all propagation
          
          this.dbg('[REPLACEMENT] Enter key detected, calling applyAll');
          // Directly call applyAll instead of clicking button
          this.applyAll();
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation(); // Stop all propagation
          
          this.dbg('[REPLACEMENT] Escape key detected, calling cancelReplacement');
          // Directly call cancelReplacement instead of clicking button
          this.cancelReplacement();
          break;
      }
    };
    
    // Add click outside to dismiss
    this.clickOutsideListener = (e) => {
      if (this.replacementPanel && !this.replacementPanel.contains(e.target)) {
        this.cancelReplacement();
      }
    };
    
    // Use capture phase for keyboard events to intercept them early
    document.addEventListener('keydown', this.replacementShortcuts, true);
    document.addEventListener('click', this.clickOutsideListener);
  }

  // Remove keyboard shortcuts
  removeReplacementShortcuts() {
    if (this.replacementShortcuts) {
      document.removeEventListener('keydown', this.replacementShortcuts, true); // Remove from capture phase
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
    overlayElement.style.position = 'fixed'; // Use fixed positioning to avoid scroll issues
    overlayElement.style.zIndex = '10001';
    
    // Calculate position to place it above the text area (using viewport-relative coordinates)
    const topPosition = Math.max(10, rect.top - 80); // Position 80px above the text area
    const leftPosition = rect.left;
    
    overlayElement.style.top = `${topPosition}px`;
    overlayElement.style.left = `${leftPosition}px`;
    
    console.log('[CUSTOM COMMANDS] Positioned at:', { topPosition, leftPosition });
    
    // Ensure it doesn't go off-screen horizontally
    const overlayWidth = 400; // Approximate width
    const viewportWidth = window.innerWidth;
    const rightEdge = leftPosition + overlayWidth;
    
    if (rightEdge > viewportWidth - 10) {
      const newLeftPosition = Math.max(10, viewportWidth - overlayWidth - 10);
      overlayElement.style.left = `${newLeftPosition}px`;
      console.log('[CUSTOM COMMANDS] Adjusted left position to:', newLeftPosition);
    }
    
    // Ensure it doesn't go off-screen vertically
    if (topPosition < 10) {
      // If it would go above the viewport, position it below the text area instead
      const bottomPosition = rect.bottom + 10;
      overlayElement.style.top = `${bottomPosition}px`;
      console.log('[CUSTOM COMMANDS] Adjusted to position below text area:', bottomPosition);
    }
    
    // Also ensure it doesn't go below viewport
    const viewportHeight = window.innerHeight;
    const overlayHeight = 100; // Approximate height
    if (parseFloat(overlayElement.style.top) + overlayHeight > viewportHeight - 10) {
      const adjustedTop = Math.max(10, viewportHeight - overlayHeight - 10);
      overlayElement.style.top = `${adjustedTop}px`;
      console.log('[CUSTOM COMMANDS] Adjusted to fit within viewport height:', adjustedTop);
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
  async showInlineTextHighlighting() {
    this.hidePopup(); // Remove existing popup

    if (!this.currentTextArea || !this.refinedText) return;

    // Store original text for restoration
    this.originalText = this.getTextFromElement(this.currentTextArea);
    
    // Create diff visualization
    const diff = this.createTextDiff(this.originalText, this.refinedText);
    
    // Temporarily replace text with highlighted version
    await this.setTextInElement(this.currentTextArea, this.refinedText);
    
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
  async rejectInlineRefinement() {
    if (this.autoAcceptTimeout) {
      clearTimeout(this.autoAcceptTimeout);
      this.autoAcceptTimeout = null;
    }
    
    // Restore original text
    if (this.currentTextArea && this.originalText) {
      await this.setTextInElement(this.currentTextArea, this.originalText);
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

  async replaceText() {
    if (this.currentTextArea && this.refinedText) {
      await this.setTextInElement(this.currentTextArea, this.refinedText);
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
        position: fixed;
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
        position: fixed;
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
        border: 2px solid #000000;
        border-radius: 4px;
        font-size: 14px;
        font-family: inherit;
        outline: none;
        transition: border-color 0.2s;
        box-sizing: border-box;
        color: #000000 !important;
        background-color: #ffffff !important;
      }

      .custom-instruction-input:focus {
        border-color: #000000;
        box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25);
        color: #000000 !important;
        background-color: #ffffff !important;
      }

      .custom-instruction-input::placeholder {
        color: #666666 !important;
        opacity: 1 !important;
      }

      .custom-instruction-input::-webkit-input-placeholder {
        color: #666666 !important;
        opacity: 1 !important;
      }

      .custom-instruction-input::-moz-placeholder {
        color: #666666 !important;
        opacity: 1 !important;
      }

      .custom-instruction-input:-ms-input-placeholder {
        color: #666666 !important;
        opacity: 1 !important;
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
