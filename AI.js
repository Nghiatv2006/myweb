// ============================================
// GEMINI API CONFIGURATION
// ============================================

let GEMINI_API_KEY = '';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// ============================================
// STATE MANAGEMENT
// ============================================

let conversationHistory = [];
let currentConversationId = generateId();
let allConversations = loadConversationsFromStorage();
let isWaitingForResponse = false;
let selectedModel = loadSelectedModel();
let attachedFiles = [];
let systemPrompt = loadSystemPrompt();

// ============================================
// UTILITY FUNCTIONS
// ============================================

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function saveConversationsToStorage() {
    localStorage.setItem('chatConversations', JSON.stringify(allConversations));
}

function loadConversationsFromStorage() {
    const stored = localStorage.getItem('chatConversations');
    return stored ? JSON.parse(stored) : [];
}

function saveApiKey(key) {
    localStorage.setItem('gemini_api_key', key);
    GEMINI_API_KEY = key;
}

function loadApiKey() {
    return localStorage.getItem('gemini_api_key') || '';
}

function loadSelectedModel() {
    return localStorage.getItem('selected_model') || 'gemini-2.0-flash-exp';
}

function saveSelectedModel(model) {
    localStorage.setItem('selected_model', model);
    selectedModel = model;
}

function loadSystemPrompt() {
    return localStorage.getItem('system_prompt') || '';
}

function saveSystemPrompt(prompt) {
    localStorage.setItem('system_prompt', prompt);
    systemPrompt = prompt;
}

// ============================================
// FILE HANDLING FUNCTIONS
// ============================================

async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ============================================
// CONTEXT SUMMARIZATION
// ============================================

async function summarizeOldMessages(messages) {
    if (messages.length === 0) return null;
    
    const conversationText = messages.map((msg, idx) => 
        `${msg.isUser ? 'User' : 'AI'}: ${msg.content}`
    ).join('\n\n');
    
    const summaryPrompt = `Tóm tắt ngắn gọn cuộc trò chuyện sau (3-5 câu, giữ lại ý chính và context quan trọng):

${conversationText}

Tóm tắt:`;

    try {
        showToast('🧠 AI đang tóm tắt ngữ cảnh cũ...', 2000);
        
        const response = await fetch(
            `${BASE_URL}/${selectedModel}:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: summaryPrompt }] }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 500
                    }
                })
            }
        );

        if (!response.ok) {
            console.error('Summary failed, skipping...');
            showToast('⚠️ Tóm tắt thất bại, tiếp tục chat bình thường', 2000);
            return null;
        }

        const data = await response.json();
        const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (summary) {
            showToast('✅ Đã tóm tắt ngữ cảnh thành công!', 2000);
        }
        
        return summary ? `[Tóm tắt cuộc trò chuyện trước]: ${summary}` : null;
    } catch (error) {
        console.error('Summarization error:', error);
        showToast('❌ Lỗi khi tóm tắt', 2000);
        return null;
    }
}

// ============================================
// GEMINI API FUNCTIONS
// ============================================

async function sendToGeminiStreaming(userMessage, files = []) {
    const contents = [];
    
    if (systemPrompt.trim()) {
        contents.push({
            role: "user",
            parts: [{ text: `System: ${systemPrompt}` }]
        });
        contents.push({
            role: "model",
            parts: [{ text: "Understood. I will follow these instructions." }]
        });
    }
    
    // Smart context management with cached summarization
    let recentHistory;
    let summaryMessage = null;

    if (conversationHistory.length > 50) {
        const summaryKey = `summary_${currentConversationId}`;
        let cachedSummary = localStorage.getItem(summaryKey);
        
        if (!cachedSummary) {
            const oldCount = conversationHistory.length - 20;
            const oldMessages = conversationHistory.slice(0, oldCount);
            
            summaryMessage = await summarizeOldMessages(oldMessages);
            if (summaryMessage) {
                localStorage.setItem(summaryKey, summaryMessage);
            }
        } else {
            summaryMessage = cachedSummary;
        }
        
        recentHistory = conversationHistory.slice(-20);
    } else {
        recentHistory = conversationHistory;
    }

    // Add summary silently
    if (summaryMessage) {
        contents.push({
            role: "user",
            parts: [{ text: summaryMessage }]
        });
    }
    
    for (const msg of recentHistory) {
        const parts = [{ text: msg.content }];
        
        if (msg.files && msg.files.length > 0) {
            for (const fileData of msg.files) {
                if (fileData.base64 && fileData.mimeType) {
                    parts.push({
                        inline_data: {
                            mime_type: fileData.mimeType,
                            data: fileData.base64
                        }
                    });
                }
            }
        }
        
        contents.push({
            role: msg.isUser ? "user" : "model",
            parts: parts
        });
    }
    
    const currentParts = [{ text: userMessage }];
    
    for (const file of files) {
        const base64Data = await fileToBase64(file);
        currentParts.push({
            inline_data: {
                mime_type: file.type,
                data: base64Data
            }
        });
    }
    
    contents.push({
        role: "user",
        parts: currentParts
    });
    
    const payload = {
        contents: contents,
        generationConfig: {
            temperature: 0.9,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,
        }
    };

    try {
        const response = await fetch(
            `${BASE_URL}/${selectedModel}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        );

        if (response.status === 429) {
            showRateLimitModal();
            throw new Error('Rate limit exceeded');
        }

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        return response;
    } catch (error) {
        console.error('Gemini API Error:', error);
        throw error;
    }
}

async function* streamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.candidates && parsed.candidates[0]) {
                            const content = parsed.candidates[0].content;
                            if (content && content.parts && content.parts[0]) {
                                yield content.parts[0].text || '';
                            }
                        }
                    } catch (e) {
                        console.error('Parse error:', e);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Stream error:', error);
        throw error;
    }
}

// ============================================
// UI FUNCTIONS
// ============================================

function showToast(message, duration = 3000) {
    const toast = document.getElementById('toastNotification');
    const toastMessage = document.getElementById('toastMessage');
    
    toastMessage.textContent = message;
    toast.classList.remove('hidden', 'hiding');
    
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => {
            toast.classList.add('hidden');
            toast.classList.remove('hiding');
        }, 300);
    }, duration);
}

function showRateLimitModal() {
    const rateLimitModal = document.getElementById('rateLimitModal');
    rateLimitModal.classList.remove('hidden');
}

function hideRateLimitModal() {
    const rateLimitModal = document.getElementById('rateLimitModal');
    rateLimitModal.classList.add('hidden');
}

function processMarkdown(text) {
    marked.setOptions({
        breaks: true,
        gfm: true,
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        }
    });
    
    return marked.parse(text);
}

function addCopyButtons(container) {
    container.querySelectorAll('pre').forEach((pre) => {
        const codeBlock = pre.querySelector('code');
        if (!codeBlock) return;
        
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block';
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = () => {
            const code = codeBlock.textContent;
            copyToClipboard(code, copyBtn);
        };
        
        wrapper.appendChild(copyBtn);
    });
}

function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
        const originalText = button.innerHTML;
        button.innerHTML = '✓ Đã sao chép!';
        setTimeout(() => {
            button.innerHTML = originalText;
        }, 2000);
    });
}

function scrollToBottom() {
    const chatMessages = document.getElementById('chatMessages');
    const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
    chatMessages.scrollTop = chatMessages.scrollHeight;
    scrollToBottomBtn.classList.add('hidden');
}

function addMessage(content, isUser = false, isStreaming = false, files = []) {
    const chatMessages = document.getElementById('chatMessages');
    let messageDiv;
    
    if (isStreaming) {
        messageDiv = document.getElementById('streamingMessage');
        if (!messageDiv) {
            messageDiv = document.createElement('div');
            messageDiv.id = 'streamingMessage';
            messageDiv.className = 'message ai-message mb-6 p-6 rounded-2xl shadow-sm';
            
            const header = document.createElement('div');
            header.className = 'flex items-center gap-2 mb-3 font-semibold';
            header.innerHTML = `
                <div class="w-8 h-8 rounded-full flex items-center justify-center" style="background-color: var(--border-color); color: var(--text-primary);">
                    AI
                </div>
                <span>AI Assistant</span>
            `;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'prose max-w-none';
            contentDiv.id = 'streamingContent';
            
            messageDiv.appendChild(header);
            messageDiv.appendChild(contentDiv);
            
            const container = chatMessages.querySelector('.max-w-3xl') || chatMessages;
            container.appendChild(messageDiv);
        }
        
        const contentDiv = document.getElementById('streamingContent');
        const processed = processMarkdown(content);
        contentDiv.innerHTML = processed;
        
        setTimeout(() => {
            contentDiv.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
            addCopyButtons(contentDiv);
        }, 10);
        
    } else {
        messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'} mb-6 p-6 rounded-2xl shadow-sm`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'prose max-w-none';
        
        if (isUser) {
            // Preserve line breaks - escape HTML first for security
            const escapedContent = content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            
            contentDiv.innerHTML = escapedContent.replace(/\n/g, '<br>');
        
        
            
            if (files && files.length > 0) {
                const imagesDiv = document.createElement('div');
                imagesDiv.className = 'user-message-images';
                
                files.forEach(file => {
                    if (file.type && file.type.startsWith('image/')) {
                        const img = document.createElement('img');
                        if (file instanceof File) {
                            img.src = URL.createObjectURL(file);
                        } else if (file.base64 && file.mimeType) {
                            img.src = `data:${file.mimeType};base64,${file.base64}`;
                        }
                        img.alt = file.name || 'Image';
                        img.onclick = () => window.open(img.src, '_blank');
                        imagesDiv.appendChild(img);
                    }
                });
                
                contentDiv.appendChild(imagesDiv);
            }
        } else {
            const processed = processMarkdown(content);
            contentDiv.innerHTML = processed;
            
            setTimeout(() => {
                contentDiv.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
                addCopyButtons(contentDiv);
            }, 10);
        }
        
        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 mb-3 font-semibold';
        header.innerHTML = `
            <div class="w-8 h-8 rounded-full flex items-center justify-center" style="background-color: ${isUser ? 'var(--button-bg)' : 'var(--border-color)'}; color: ${isUser ? 'white' : 'var(--text-primary)'};">
                ${isUser ? 'U' : 'AI'}
            </div>
            <span>${isUser ? 'Bạn' : 'AI Assistant'}</span>
        `;
        
        messageDiv.insertBefore(header, messageDiv.firstChild);
        messageDiv.appendChild(contentDiv);
        
        if (!isUser) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'mt-3 px-3 py-1 text-sm rounded-lg transition-all bg-user-msg text-primary';
            copyBtn.innerHTML = `
                <svg class="inline-block w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
                Sao chép
            `;
            copyBtn.onclick = () => copyToClipboard(content, copyBtn);
            messageDiv.appendChild(copyBtn);
        }
        
        const container = chatMessages.querySelector('.max-w-3xl') || chatMessages;
        container.appendChild(messageDiv);
    }
    
    scrollToBottom();
}

function finalizeStreamingMessage() {
    const streamingMsg = document.getElementById('streamingMessage');
    if (streamingMsg) {
        streamingMsg.id = '';
        
        const content = document.getElementById('streamingContent');
        if (content) {
            content.id = '';
            const copyBtn = document.createElement('button');
            copyBtn.className = 'mt-3 px-3 py-1 text-sm rounded-lg transition-all bg-user-msg text-primary';
            copyBtn.innerHTML = `
                <svg class="inline-block w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
                Sao chép
            `;
            copyBtn.onclick = () => copyToClipboard(content.textContent, copyBtn);
            streamingMsg.appendChild(copyBtn);
        }
    }
}

function addTypingIndicator() {
    const chatMessages = document.getElementById('chatMessages');
    const typingDiv = document.createElement('div');
    typingDiv.id = 'typingIndicator';
    typingDiv.className = 'message ai-message mb-6 p-6 rounded-2xl shadow-sm';
    typingDiv.innerHTML = `
        <div class="flex items-center gap-2 mb-3 font-semibold">
            <div class="w-8 h-8 rounded-full flex items-center justify-center" style="background-color: var(--border-color); color: var(--text-primary);">
                AI
            </div>
            <span>AI Assistant</span>
        </div>
        <div class="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
        </div>
    `;
    
    const container = chatMessages.querySelector('.max-w-3xl') || chatMessages;
    container.appendChild(typingDiv);
    scrollToBottom();
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
}

function clearChatDisplay() {
    const chatMessages = document.getElementById('chatMessages');
    const container = chatMessages.querySelector('.max-w-3xl');
    if (container) {
        container.innerHTML = `
            <div class="text-center py-12">
                <div class="inline-block p-4 rounded-full mb-4 bg-user-msg">
                    <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
                    </svg>
                </div>
                <h2 class="text-2xl font-bold mb-2 text-primary">Xin chào! Tôi có thể giúp gì cho bạn?</h2>
                <p class="text-secondary">Powered by Gemini AI</p>
            </div>
        `;
    }
}

function updateConversationHistory() {
    const conversationHistoryEl = document.getElementById('conversationHistory');
    conversationHistoryEl.innerHTML = '';
    
    const sortedConversations = [...allConversations].sort((a, b) => b.timestamp - a.timestamp);
    
    sortedConversations.slice(0, 20).forEach((conv) => {
        const item = document.createElement('div');
        item.className = 'history-item px-3 py-2 rounded-lg cursor-pointer transition-all flex items-center justify-between group';
        
        const title = conv.messages[0]?.content.substring(0, 30) + '...' || 'Cuộc trò chuyện mới';
        
        item.innerHTML = `
            <span class="text-sm truncate flex-1">${title}</span>
            <button class="delete-conv opacity-0 group-hover:opacity-100 transition-opacity p-1" data-id="${conv.id}">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        `;
        
        item.querySelector('span').onclick = () => loadConversation(conv.id);
        item.querySelector('.delete-conv').onclick = (e) => {
            e.stopPropagation();
            deleteConversation(conv.id);
        };
        
        conversationHistoryEl.appendChild(item);
    });
}

function saveCurrentConversation() {
    if (conversationHistory.length === 0) return;
    
    const existingIndex = allConversations.findIndex(c => c.id === currentConversationId);
    
    const conversation = {
        id: currentConversationId,
        messages: conversationHistory,
        timestamp: Date.now()
    };
    
    if (existingIndex >= 0) {
        allConversations[existingIndex] = conversation;
    } else {
        allConversations.push(conversation);
    }
    
    saveConversationsToStorage();
    updateConversationHistory();
}

function loadConversation(id) {
    const conv = allConversations.find(c => c.id === id);
    if (!conv) return;
    
    currentConversationId = id;
    conversationHistory = [...conv.messages];
    
    clearChatDisplay();
    
    conversationHistory.forEach(msg => {
        addMessage(msg.content, msg.isUser, false, msg.files);
    });
}

function deleteConversation(id) {
    allConversations = allConversations.filter(c => c.id !== id);
    saveConversationsToStorage();
    updateConversationHistory();
    
    if (currentConversationId === id) {
        newChat();
    }
}

function newChat() {
    conversationHistory = [];
    currentConversationId = generateId();
    attachedFiles = [];
    
    // Clear summary cache for new conversation
    localStorage.removeItem(`summary_${currentConversationId}`);
    
    const filePreviewArea = document.getElementById('filePreviewArea');
    filePreviewArea.innerHTML = '';
    filePreviewArea.classList.add('hidden');
    
    clearChatDisplay();
    
    const messageInput = document.getElementById('messageInput');
    messageInput.focus();
}

// ============================================
// MESSAGE HANDLING
// ============================================

async function handleSendMessage() {
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    
    const message = messageInput.value.trim();
    
    if ((!message && attachedFiles.length === 0) || isWaitingForResponse) return;
    
    const files = [...attachedFiles];
    const messageText = message || '[Đã gửi file]';
    
    const filesData = [];
    for (const file of files) {
        const base64 = await fileToBase64(file);
        filesData.push({
            name: file.name,
            type: file.type,
            mimeType: file.type,
            base64: base64
        });
    }
    
    addMessage(messageText, true, false, files);
    conversationHistory.push({ 
        content: messageText, 
        isUser: true, 
        files: filesData 
    });
    
    messageInput.value = '';
    messageInput.style.height = 'auto';
    attachedFiles = [];
    
    const filePreviewArea = document.getElementById('filePreviewArea');
    filePreviewArea.innerHTML = '';
    filePreviewArea.classList.add('hidden');
    
    isWaitingForResponse = true;
    sendBtn.disabled = true;
    
    addTypingIndicator();
    
    try {
        const response = await sendToGeminiStreaming(message || 'Mô tả file này', files);
        removeTypingIndicator();
        
        let fullResponse = '';
        
        for await (const chunk of streamResponse(response)) {
            fullResponse += chunk;
            addMessage(fullResponse, false, true);
        }
        
        finalizeStreamingMessage();
        conversationHistory.push({ content: fullResponse, isUser: false });
        saveCurrentConversation();
        
    } catch (error) {
        removeTypingIndicator();
        if (error.message !== 'Rate limit exceeded') {
            addMessage('Xin lỗi, đã xảy ra lỗi. Vui lòng thử lại.', false);
        }
    } finally {
        isWaitingForResponse = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chatMessages');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const newChatBtn = document.getElementById('newChatBtn');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const toggleSidebar = document.getElementById('toggleSidebar');
    const sidebar = document.getElementById('sidebar');
    const rateLimitModal = document.getElementById('rateLimitModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const apiKeyModal = document.getElementById('apiKeyModal');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    const changeApiKeyBtn = document.getElementById('changeApiKeyBtn');
    const fileInput = document.getElementById('fileInput');
    const attachFileBtn = document.getElementById('attachFileBtn');
    const filePreviewArea = document.getElementById('filePreviewArea');
    const dropOverlay = document.getElementById('dropOverlay');
    const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    const systemPromptBtn = document.getElementById('systemPromptBtn');
    const systemPromptModal = document.getElementById('systemPromptModal');
    const systemPromptInput = document.getElementById('systemPromptInput');
    const saveSystemPromptBtn = document.getElementById('saveSystemPromptBtn');
    const closeSystemPromptBtn = document.getElementById('closeSystemPromptBtn');
    
    const modelSelectorBtn = document.getElementById('modelSelectorBtn');
    const modelSelectorModal = document.getElementById('modelSelectorModal');
    const closeModelSelectorBtn = document.getElementById('closeModelSelectorBtn');
    const currentModelIcon = document.getElementById('currentModelIcon');
    const currentModelName = document.getElementById('currentModelName');
    const modelOptions = document.querySelectorAll('.model-option');
    
    const savedApiKey = loadApiKey();
    if (savedApiKey) {
        GEMINI_API_KEY = savedApiKey;
        apiKeyModal.classList.add('hidden');
    } else {
        apiKeyModal.classList.remove('hidden');
    }
    
    systemPromptInput.value = systemPrompt;
    
    const modelIcons = {
        'gemini-2.0-flash-exp': '⚡',
        'gemini-exp-1206': '🚀',
        'gemini-2.5-flash': '💨',
        'gemini-2.5-pro': '💎'
    };

    const modelNames = {
        'gemini-2.0-flash-exp': 'Flash 2.0',
        'gemini-exp-1206': 'Exp 1206',
        'gemini-2.5-flash': 'Flash 2.5',
        'gemini-2.5-pro': 'Pro 2.5'
    };

    function updateModelDisplay() {
        currentModelIcon.textContent = modelIcons[selectedModel] || '⚡';
        currentModelName.textContent = modelNames[selectedModel] || 'Flash 2.0';
        
        modelOptions.forEach(option => {
            if (option.dataset.model === selectedModel) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
            }
        });
    }
    
    function handleFileSelect(event) {
        const files = Array.from(event.target.files);
        files.forEach(file => {
            if (file.size > 20 * 1024 * 1024) {
                alert(`File ${file.name} quá lớn. Giới hạn 20MB.`);
                return;
            }
            attachedFiles.push(file);
        });
        updateFilePreview();
    }
    
    function updateFilePreview() {
        filePreviewArea.innerHTML = '';
        if (attachedFiles.length === 0) {
            filePreviewArea.classList.add('hidden');
            return;
        }
        
        filePreviewArea.classList.remove('hidden');
        attachedFiles.forEach((file, index) => {
            const preview = document.createElement('div');
            preview.className = 'file-preview-item';
            
            if (file.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.className = 'w-16 h-16 object-cover rounded';
                img.src = URL.createObjectURL(file);
                preview.appendChild(img);
            } else {
                preview.innerHTML = `
                    <svg class="w-8 h-8 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                    </svg>
                    <span class="text-xs ml-1">${file.name.substring(0, 15)}</span>
                `;
            }
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'file-preview-remove';
            removeBtn.innerHTML = '×';
            removeBtn.onclick = () => {
                attachedFiles.splice(index, 1);
                updateFilePreview();
            };
            
            preview.appendChild(removeBtn);
            filePreviewArea.appendChild(preview);
        });
    }
    
    function updateScrollButton() {
        const scrollTop = chatMessages.scrollTop;
        const scrollHeight = chatMessages.scrollHeight;
        const clientHeight = chatMessages.clientHeight;
        
        if (scrollHeight - scrollTop - clientHeight > 100) {
            scrollToBottomBtn.classList.remove('hidden');
        } else {
            scrollToBottomBtn.classList.add('hidden');
        }
    }
    
    sendBtn.addEventListener('click', handleSendMessage);

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            // Desktop: Enter = send, Shift+Enter = new line
            // Mobile: Enter = new line (use send button to send)
            const isMobile = window.innerWidth <= 768 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
            
            if (!isMobile && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
            // On mobile or Shift+Enter: do nothing, let textarea handle new line
        }
    });
    

    messageInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 200) + 'px';
    });

    newChatBtn.addEventListener('click', newChat);

    clearAllBtn.addEventListener('click', () => {
        if (confirm('Bạn có chắc muốn xóa tất cả lịch sử trò chuyện?')) {
            allConversations = [];
            saveConversationsToStorage();
            updateConversationHistory();
            newChat();
        }
    });

    toggleSidebar.addEventListener('click', () => {
        sidebar.classList.toggle('closed');
        
        if (window.innerWidth <= 768) {
            sidebarOverlay.classList.toggle('active');
        }
    });

    document.body.addEventListener('click', (e) => {
        if (e.target.id === 'closeSidebarBtn' || e.target.closest('#closeSidebarBtn')) {
            sidebar.classList.add('closed');
            sidebarOverlay.classList.remove('active');
        }
    });

    sidebarOverlay.addEventListener('click', () => {
        sidebar.classList.add('closed');
        sidebarOverlay.classList.remove('active');
    });

    closeModalBtn.addEventListener('click', hideRateLimitModal);

    rateLimitModal.addEventListener('click', (e) => {
        if (e.target === rateLimitModal) {
            hideRateLimitModal();
        }
    });

    saveApiKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            saveApiKey(key);
            apiKeyModal.classList.add('hidden');
        } else {
            alert('Vui lòng nhập API key hợp lệ');
        }
    });

    changeApiKeyBtn.addEventListener('click', () => {
        apiKeyModal.classList.remove('hidden');
        apiKeyInput.value = '';
        apiKeyInput.focus();
    });

    systemPromptBtn.addEventListener('click', () => {
        systemPromptModal.classList.remove('hidden');
        systemPromptInput.focus();
    });

    saveSystemPromptBtn.addEventListener('click', () => {
        const prompt = systemPromptInput.value.trim();
        saveSystemPrompt(prompt);
        systemPromptModal.classList.add('hidden');
        alert('System prompt đã được lưu! Áp dụng cho cuộc trò chuyện mới.');
    });

    closeSystemPromptBtn.addEventListener('click', () => {
        systemPromptModal.classList.add('hidden');
    });

    systemPromptModal.addEventListener('click', (e) => {
        if (e.target === systemPromptModal) {
            systemPromptModal.classList.add('hidden');
        }
    });

    modelSelectorBtn.addEventListener('click', () => {
        modelSelectorModal.classList.remove('hidden');
        updateModelDisplay();
    });

    closeModelSelectorBtn.addEventListener('click', () => {
        modelSelectorModal.classList.add('hidden');
    });

    modelSelectorModal.addEventListener('click', (e) => {
        if (e.target === modelSelectorModal) {
            modelSelectorModal.classList.add('hidden');
        }
    });

    modelOptions.forEach(option => {
        option.addEventListener('click', () => {
            const model = option.dataset.model;
            saveSelectedModel(model);
            updateModelDisplay();
            modelSelectorModal.classList.add('hidden');
        });
    });

    attachFileBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', handleFileSelect);

    chatMessages.addEventListener('scroll', updateScrollButton);

    scrollToBottomBtn.addEventListener('click', () => {
        scrollToBottom();
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropOverlay.classList.remove('hidden');
    });

    document.addEventListener('dragleave', (e) => {
        if (e.target === dropOverlay) {
            dropOverlay.classList.add('hidden');
        }
    });

    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropOverlay.classList.add('hidden');
        
        const files = Array.from(e.dataTransfer.files);
        files.forEach(file => {
            if (file.size <= 20 * 1024 * 1024) {
                attachedFiles.push(file);
            }
        });
        updateFilePreview();
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            sidebarOverlay.classList.remove('active');
        }
    });
    
    updateConversationHistory();
    updateModelDisplay();
    messageInput.focus();
    
    console.log('🚀 AI Chat Agent initialized with smart context summarization!');
});
