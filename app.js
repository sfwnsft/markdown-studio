(function () {
  'use strict';

  const STORAGE_KEY = 'md_live_editor_content';

  function isMacSystem() {
    if (typeof navigator === 'undefined') return false;
    if (navigator.userAgentData && navigator.userAgentData.platform) {
      return /mac/i.test(navigator.userAgentData.platform);
    }
    const platform = navigator.platform || navigator.userAgent || '';
    return /Mac|iPhone|iPod|iPad/i.test(platform);
  }

  function getModifierLabel() {
    return isMacSystem() ? 'Cmd' : 'Ctrl';
  }

  function getAltLabel() {
    return isMacSystem() ? 'Opt' : 'Alt';
  }

  function getDefaultMarkdown() {
    return `# Untitled Document

Start writing your Markdown here...
`;
  }

  function adaptShortcutsForOS() {
    const isMac = isMacSystem();
    const mod = isMac ? 'Cmd' : 'Ctrl';
    const alt = isMac ? 'Opt' : 'Alt';

    const shortcutsMap = [
      { id: 'btnUndo', title: `Undo (${mod} + Z)` },
      { id: 'btnRedo', title: isMac ? `Redo (Cmd + Shift + Z / Cmd + Y)` : `Redo (Ctrl + Y / Ctrl + Shift + Z)` },
      { id: 'headingDropdownTrigger', title: `Headings (${mod} + ${alt} + 1..6)` },
      { selector: '[data-format="bold"]', title: `Bold (${mod} + B)` },
      { selector: '[data-format="italic"]', title: `Italic (${mod} + I)` },
      { selector: '[data-format="underline"]', title: `Underline (${mod} + U)` },
      { selector: '[data-format="link"]', title: `Insert Link (${mod} + K)` }
    ];

    shortcutsMap.forEach(({ id, selector, title }) => {
      const el = id ? document.getElementById(id) : document.querySelector(selector);
      if (el) {
        el.setAttribute('title', title);
      }
    });

    const hintBadges = document.querySelectorAll('.shortcut-hint');
    hintBadges.forEach((badge) => {
      badge.textContent = badge.textContent
        .replace(/Ctrl/g, mod)
        .replace(/Cmd/g, mod)
        .replace(/Alt/g, alt)
        .replace(/Opt/g, alt)
        .replace(/\+/g, ' + ')
        .replace(/\s+/g, ' ')
        .trim();
    });
  }

  const markdownInput = document.getElementById('markdownInput');
  const markdownPreview = document.getElementById('markdownPreview');
  const previewBody = document.getElementById('previewBody');
  const wordCountEl = document.getElementById('wordCount');
  const charCountEl = document.getElementById('charCount');
  const lineCountEl = document.getElementById('lineCount');
  const saveStatusEl = document.getElementById('saveStatus');
  const readingTimeEl = document.getElementById('readingTime');

  const btnClear = document.getElementById('btnClear');
  const btnExportMd = document.getElementById('btnExportMd');
  const btnExportPdf = document.getElementById('btnExportPdf');
  const btnCopyRaw = document.getElementById('btnCopyRaw');
  const btnCopyHtml = document.getElementById('btnCopyHtml');
  const btnSyncScroll = document.getElementById('btnSyncScroll');
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');

  const headingDropdown = document.getElementById('headingDropdown');
  const headingDropdownTrigger = document.getElementById('headingDropdownTrigger');
  const headingMenu = document.getElementById('headingMenu');

  const clearModal = document.getElementById('clearModal');
  const btnCancelClear = document.getElementById('btnCancelClear');
  const btnConfirmClear = document.getElementById('btnConfirmClear');

  const viewSwitcher = document.getElementById('viewSwitcher');
  const workspaceContainer = document.getElementById('workspaceContainer');
  const paneResizer = document.getElementById('paneResizer');
  const editorPane = document.getElementById('editorPane');
  const previewPane = document.getElementById('previewPane');
  const toastContainer = document.getElementById('toastContainer');

  const formatButtons = document.querySelectorAll('.tool-btn[data-format]');

  let saveTimeout = null;
  let isDraggingResizer = false;

  class HistoryManager {
    constructor(textarea, onApply) {
      this.textarea = textarea;
      this.onApply = onApply;
      this.undoStack = [];
      this.redoStack = [];
      this.maxHistory = 100;
      this.isApplying = false;
      this.lastInputTime = 0;
    }

    getCurrentState() {
      return {
        value: this.textarea.value,
        start: this.textarea.selectionStart,
        end: this.textarea.selectionEnd
      };
    }

    recordState() {
      if (this.isApplying) return;

      const current = this.getCurrentState();
      const last = this.undoStack[this.undoStack.length - 1];

      if (last && last.value === current.value) {
        last.start = current.start;
        last.end = current.end;
        return;
      }

      this.undoStack.push(current);
      if (this.undoStack.length > this.maxHistory) {
        this.undoStack.shift();
      }

      this.redoStack = [];
      this.updateButtons();
    }

    handleTyping() {
      if (this.isApplying) return;

      const now = Date.now();
      const current = this.getCurrentState();
      const last = this.undoStack[this.undoStack.length - 1];

      if (!last || (now - this.lastInputTime > 400) || Math.abs(current.value.length - last.value.length) > 20) {
        this.recordState();
      }
      this.lastInputTime = now;
    }

    undo() {
      if (this.undoStack.length <= 1) return false;

      this.isApplying = true;
      const currentState = this.undoStack.pop();
      this.redoStack.push(currentState);

      const targetState = this.undoStack[this.undoStack.length - 1];
      this.applyState(targetState);
      this.isApplying = false;
      this.updateButtons();
      return true;
    }

    redo() {
      if (this.redoStack.length === 0) return false;

      this.isApplying = true;
      const targetState = this.redoStack.pop();
      this.undoStack.push(targetState);

      this.applyState(targetState);
      this.isApplying = false;
      this.updateButtons();
      return true;
    }

    applyState(state) {
      this.textarea.value = state.value;
      this.textarea.setSelectionRange(state.start, state.end);
      this.onApply();
    }

    updateButtons() {
      if (btnUndo) {
        btnUndo.disabled = this.undoStack.length <= 1;
      }
      if (btnRedo) {
        btnRedo.disabled = this.redoStack.length === 0;
      }
    }
  }

  let historyManager = null;

  if (typeof marked !== 'undefined') {
    const markedConfig = {
      gfm: true,
      breaks: true,
      pedantic: false
    };
    if (typeof marked.use === 'function') {
      marked.use(markedConfig);
    } else if (typeof marked.setOptions === 'function') {
      marked.setOptions(markedConfig);
    }
  }

  function init() {
    adaptShortcutsForOS();
    loadContent();
    historyManager = new HistoryManager(markdownInput, () => {
      render();
      scheduleAutoSave();
    });
    historyManager.recordState();
    render();
    bindEvents();
    setupResizer();
    setupHeadingDropdown();

    if (window.innerWidth > 768) {
      markdownInput.focus();
    }
  }

  function loadContent() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null && saved !== undefined && !saved.startsWith('# Monochrome Markdown Studio')) {
        markdownInput.value = saved;
      } else {
        const defaultDoc = getDefaultMarkdown();
        markdownInput.value = defaultDoc;
        saveToLocalStorage(defaultDoc);
      }
    } catch (err) {
      console.warn('LocalStorage access issue:', err);
      markdownInput.value = getDefaultMarkdown();
    }
  }

  function saveToLocalStorage(content) {
    showSaveStatus(true);
    try {
      localStorage.setItem(STORAGE_KEY, content);
      setTimeout(() => showSaveStatus(false), 300);
    } catch (err) {
      console.error('Failed to save to localStorage:', err);
      showSaveStatus(false);
    }
  }

  function scheduleAutoSave() {
    showSaveStatus(true);
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveToLocalStorage(markdownInput.value);
    }, 450);
  }

  function showSaveStatus(isSaving) {
    if (!saveStatusEl) return;
    if (isSaving) {
      saveStatusEl.classList.add('saving');
      saveStatusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> <span>Saving...</span>';
    } else {
      saveStatusEl.classList.remove('saving');
      saveStatusEl.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> <span>Saved</span>';
    }
  }

  function render() {
    const rawMarkdown = markdownInput.value;

    if (typeof marked !== 'undefined') {
      try {
        markdownPreview.innerHTML = marked.parse(rawMarkdown);
        enhanceRenderedPreview();
      } catch (err) {
        markdownPreview.innerHTML = `<p class="error-msg">Error rendering markdown: ${escapeHtml(err.message)}</p>`;
      }
    } else {
      markdownPreview.textContent = rawMarkdown;
    }

    updateStats(rawMarkdown);
  }

  function enhanceRenderedPreview() {
    const checkboxes = markdownPreview.querySelectorAll('li > input[type="checkbox"], li > p > input[type="checkbox"]');
    checkboxes.forEach((checkbox, index) => {
      const li = checkbox.closest('li');
      if (li) {
        li.classList.add('task-list-item');
        if (li.parentElement && li.parentElement.tagName === 'UL') {
          li.parentElement.classList.add('contains-task-list');
        }
      }
      checkbox.removeAttribute('disabled');
      checkbox.dataset.taskIndex = String(index);
      checkbox.addEventListener('change', () => {
        toggleMarkdownTaskItem(index, checkbox.checked);
      });
    });

    const links = markdownPreview.querySelectorAll('a[href]');
    links.forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
    });

    const tables = markdownPreview.querySelectorAll('table');
    tables.forEach((table) => {
      if (table.parentElement && !table.parentElement.classList.contains('table-wrapper')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrapper';
        table.parentElement.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }
    });
  }

  function toggleMarkdownTaskItem(targetIndex, isChecked) {
    const lines = markdownInput.value.split('\n');
    let currentTaskIndex = 0;
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      const taskMatch = line.match(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s*.*)$/);
      if (taskMatch) {
        if (currentTaskIndex === targetIndex) {
          historyManager.recordState();
          lines[i] = `${taskMatch[1]}${isChecked ? 'x' : ' '}${taskMatch[3]}`;
          const scrollPos = markdownInput.scrollTop;
          markdownInput.value = lines.join('\n');
          markdownInput.scrollTop = scrollPos;
          render();
          scheduleAutoSave();
          historyManager.recordState();
          break;
        }
        currentTaskIndex++;
      }
    }
  }

  function updateStats(text) {
    const characters = text.length;

    const wordsArray = text.trim().split(/\s+/).filter(Boolean);
    const words = text.trim() === '' ? 0 : wordsArray.length;

    const lines = text === '' ? 0 : text.split('\n').length;

    if (charCountEl) charCountEl.textContent = characters.toLocaleString();
    if (wordCountEl) wordCountEl.textContent = words.toLocaleString();
    if (lineCountEl) lineCountEl.textContent = lines.toLocaleString();

    if (readingTimeEl) {
      const minutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 200));
      readingTimeEl.textContent = `${minutes} min read`;
    }
  }

  function getDocumentFilename(extension) {
    const content = markdownInput.value;
    const firstH1Match = content.match(/^#\s+(.+)$/m);
    let title = 'document';

    if (firstH1Match && firstH1Match[1]) {
      title = firstH1Match[1]
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    if (!title || title.length > 50) {
      title = 'markdown-export';
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    return `${title}-${timestamp}.${extension}`;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportMarkdown() {
    const content = markdownInput.value;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const filename = getDocumentFilename('md');
    triggerDownload(blob, filename);
    showToast(`Exported ${filename}`);
  }

  const WIN_ANSI_MAP = {
    0x20AC: 0x80,
    0x201A: 0x82,
    0x0192: 0x83,
    0x201E: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02C6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8A,
    0x2039: 0x8B,
    0x0152: 0x8C,
    0x017D: 0x8E,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201C: 0x93,
    0x201D: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02DC: 0x98,
    0x2122: 0x99,
    0x0161: 0x9A,
    0x203A: 0x9B,
    0x0153: 0x9C,
    0x017E: 0x9E,
    0x0178: 0x9F
  };

  function toWinAnsiString(str) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code <= 0xFF) {
        out += str[i];
      } else if (WIN_ANSI_MAP[code] !== undefined) {
        out += String.fromCharCode(WIN_ANSI_MAP[code]);
      } else {
        out += '?';
      }
    }
    return out;
  }

  function hasUnsupportedVectorChars(str) {
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code > 0xFF && WIN_ANSI_MAP[code] === undefined && code !== 0x2713) {
        return true;
      }
    }
    return false;
  }

  function parseRgbColor(colorStr) {
    const match = (colorStr || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (match) {
      return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
    }
    return [0, 0, 0];
  }

  function getFirstTokenRect(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.classList.contains('pdf-checkbox')) continue;
      const match = node.nodeValue.match(/\S+/);
      if (match) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return rect;
        }
      }
    }
    return null;
  }

  function renderDomToVectorPdf(container, pdf, opt) {
    const margin = opt.margin || [15, 15, 15, 15];
    const pageWidthMm = 210 - margin[1] - margin[3];
    const pageHeightMm = 297 - margin[0] - margin[2];

    const baseRect = container.getBoundingClientRect();
    const pageHeightPx = baseRect.width * (pageHeightMm / pageWidthMm);
    const flowBlocks = container.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, tr, img, hr'
    );

    flowBlocks.forEach((block) => {
      if (!block.parentNode) return;
      const cRect = container.getBoundingClientRect();
      const bRect = block.getBoundingClientRect();
      if (bRect.width === 0 && bRect.height === 0) return;

      const topPx = Math.max(0, bRect.top - cRect.top);
      const bottomPx = Math.max(0, bRect.bottom - cRect.top);
      const startPage = Math.floor((topPx + 0.5) / pageHeightPx);
      const endPage = Math.floor(Math.max(topPx + 0.5, bottomPx - 1.5) / pageHeightPx);

      if (/^H[1-6]$/.test(block.tagName) && block.nextElementSibling) {
        const next = block.nextElementSibling;
        let firstUnit = next;
        if (next.tagName === 'UL' || next.tagName === 'OL') {
          firstUnit = next.querySelector('li') || next;
        } else if (next.tagName === 'TABLE' || next.classList.contains('table-wrapper')) {
          firstUnit = next.querySelector('tr') || next;
        }
        const unitRect = firstUnit.getBoundingClientRect();
        const unitBottomPx = Math.max(0, unitRect.bottom - cRect.top);
        const unitEndPage = Math.floor(Math.max(topPx + 0.5, unitBottomPx - 1.5) / pageHeightPx);
        if (unitEndPage > startPage && unitBottomPx - topPx < pageHeightPx * 0.85) {
          const spacer = document.createElement('div');
          spacer.style.display = 'block';
          spacer.style.height = `${(startPage + 1) * pageHeightPx - topPx}px`;
          block.parentNode.insertBefore(spacer, block);
          return;
        }
      }

      if (endPage > startPage && bRect.height < pageHeightPx * 0.8) {
        if (block.tagName === 'TR') return;
        if (block.tagName === 'LI' && block.querySelector('ul, ol')) return;
        const spacer = document.createElement('div');
        spacer.style.display = 'block';
        spacer.style.height = `${(startPage + 1) * pageHeightPx - topPx}px`;
        block.parentNode.insertBefore(spacer, block);
      }
    });

    const containerRect = container.getBoundingClientRect();
    const pxToMm = pageWidthMm / containerRect.width;
    const totalHeightMm = containerRect.height * pxToMm;
    const totalPages = Math.max(1, Math.ceil((totalHeightMm - 0.5) / pageHeightMm));

    for (let p = 2; p <= totalPages; p++) {
      pdf.addPage();
    }

    function toPageCoords(rect) {
      const relTopMm = Math.max(0, (rect.top - containerRect.top) * pxToMm);
      const relLeftMm = (rect.left - containerRect.left) * pxToMm;
      const widthMm = rect.width * pxToMm;
      const heightMm = rect.height * pxToMm;
      const pageNum = Math.min(totalPages, Math.max(1, Math.floor((relTopMm + 0.2) / pageHeightMm) + 1));
      const xMm = margin[1] + relLeftMm;
      const yMm = margin[0] + (relTopMm - (pageNum - 1) * pageHeightMm);
      return { pageNum, xMm, yMm, widthMm, heightMm };
    }

    const elements = container.querySelectorAll('*');
    elements.forEach((el) => {
      const tag = el.tagName;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      if (tag === 'BLOCKQUOTE') {
        const c = toPageCoords(rect);
        pdf.setPage(c.pageNum);
        pdf.setFillColor(250, 250, 250);
        pdf.rect(c.xMm, c.yMm, c.widthMm, c.heightMm, 'F');
        pdf.setFillColor(0, 0, 0);
        pdf.rect(c.xMm, c.yMm, 0.85, c.heightMm, 'F');
      } else if (tag === 'PRE') {
        const c = toPageCoords(rect);
        pdf.setPage(c.pageNum);
        pdf.setFillColor(246, 246, 246);
        pdf.setDrawColor(229, 229, 229);
        pdf.setLineWidth(0.25);
        pdf.roundedRect(c.xMm, c.yMm, c.widthMm, c.heightMm, 1.1, 1.1, 'FD');
      } else if (tag === 'TH') {
        const c = toPageCoords(rect);
        pdf.setPage(c.pageNum);
        pdf.setFillColor(245, 245, 245);
        pdf.setDrawColor(229, 229, 229);
        pdf.setLineWidth(0.25);
        pdf.rect(c.xMm, c.yMm, c.widthMm, c.heightMm, 'FD');
        pdf.setDrawColor(212, 212, 212);
        pdf.setLineWidth(0.5);
        pdf.line(c.xMm, c.yMm + c.heightMm, c.xMm + c.widthMm, c.yMm + c.heightMm);
      } else if (tag === 'TD') {
        const c = toPageCoords(rect);
        pdf.setPage(c.pageNum);
        const tr = el.parentElement;
        const isEvenRow = tr && tr.parentElement && Array.from(tr.parentElement.children).indexOf(tr) % 2 === 1;
        if (isEvenRow) {
          pdf.setFillColor(250, 250, 250);
          pdf.setDrawColor(229, 229, 229);
          pdf.setLineWidth(0.25);
          pdf.rect(c.xMm, c.yMm, c.widthMm, c.heightMm, 'FD');
        } else {
          pdf.setDrawColor(229, 229, 229);
          pdf.setLineWidth(0.25);
          pdf.rect(c.xMm, c.yMm, c.widthMm, c.heightMm, 'S');
        }
      } else if (tag === 'H1') {
        const c = toPageCoords(rect);
        pdf.setPage(c.pageNum);
        pdf.setDrawColor(0, 0, 0);
        pdf.setLineWidth(0.55);
        pdf.line(c.xMm, c.yMm + c.heightMm, c.xMm + c.widthMm, c.yMm + c.heightMm);
      } else if (tag === 'H2') {
        const c = toPageCoords(rect);
        pdf.setPage(c.pageNum);
        pdf.setDrawColor(212, 212, 212);
        pdf.setLineWidth(0.3);
        pdf.line(c.xMm, c.yMm + c.heightMm, c.xMm + c.widthMm, c.yMm + c.heightMm);
      } else if (tag === 'HR') {
        const c = toPageCoords(rect);
        pdf.setPage(c.pageNum);
        pdf.setDrawColor(229, 229, 229);
        pdf.setLineWidth(0.3);
        pdf.line(c.xMm, c.yMm + c.heightMm / 2, c.xMm + c.widthMm, c.yMm + c.heightMm / 2);
      } else if (tag === 'CODE' && (!el.parentElement || el.parentElement.tagName !== 'PRE')) {
        const clientRects = el.getClientRects();
        for (let i = 0; i < clientRects.length; i++) {
          const c = toPageCoords(clientRects[i]);
          pdf.setPage(c.pageNum);
          pdf.setFillColor(245, 245, 245);
          pdf.setDrawColor(229, 229, 229);
          pdf.setLineWidth(0.2);
          pdf.roundedRect(c.xMm, c.yMm, c.widthMm, c.heightMm, 0.7, 0.7, 'FD');
        }
      } else if (tag === 'KBD') {
        const clientRects = el.getClientRects();
        for (let i = 0; i < clientRects.length; i++) {
          const c = toPageCoords(clientRects[i]);
          pdf.setPage(c.pageNum);
          pdf.setFillColor(245, 245, 245);
          pdf.setDrawColor(212, 212, 212);
          pdf.setLineWidth(0.25);
          pdf.roundedRect(c.xMm, c.yMm, c.widthMm, c.heightMm, 0.7, 0.7, 'FD');
        }
      } else if (el.classList.contains('pdf-checkbox')) {
        const c = toPageCoords(rect);
        pdf.setPage(c.pageNum);
        const size = Math.min(c.widthMm, c.heightMm, 3.8);
        if (el.classList.contains('checked')) {
          pdf.setFillColor(0, 0, 0);
          pdf.setDrawColor(0, 0, 0);
          pdf.setLineWidth(0.35);
          pdf.roundedRect(c.xMm, c.yMm, size, size, 0.5, 0.5, 'FD');
          pdf.setDrawColor(255, 255, 255);
          pdf.setLineWidth(0.45);
          pdf.line(c.xMm + size * 0.22, c.yMm + size * 0.52, c.xMm + size * 0.44, c.yMm + size * 0.74);
          pdf.line(c.xMm + size * 0.44, c.yMm + size * 0.74, c.xMm + size * 0.78, c.yMm + size * 0.26);
        } else {
          pdf.setFillColor(255, 255, 255);
          pdf.setDrawColor(0, 0, 0);
          pdf.setLineWidth(0.35);
          pdf.roundedRect(c.xMm, c.yMm, size, size, 0.5, 0.5, 'FD');
        }
      } else if (tag === 'LI' && !el.classList.contains('task-list-item') && el.parentElement) {
        const liCoords = toPageCoords(rect);
        const tokenRect = getFirstTokenRect(el);
        const refCoords = tokenRect ? toPageCoords(tokenRect) : liCoords;
        pdf.setPage(refCoords.pageNum);

        if (el.parentElement.tagName === 'UL') {
          let depth = 0;
          let p = el.parentElement;
          while (p && p !== container) {
            if (p.tagName === 'UL' || p.tagName === 'OL') depth++;
            p = p.parentElement;
          }
          const bulletX = liCoords.xMm - 3.2;
          const bulletY = refCoords.yMm + refCoords.heightMm * 0.52;
          pdf.setFillColor(0, 0, 0);
          pdf.setDrawColor(0, 0, 0);
          pdf.setLineWidth(0.28);
          pdf.circle(bulletX, bulletY, 0.55, depth <= 1 ? 'F' : 'S');
        } else if (el.parentElement.tagName === 'OL') {
          const siblings = Array.from(el.parentElement.children).filter((ch) => ch.tagName === 'LI');
          const idx = siblings.indexOf(el) + 1;
          const computed = window.getComputedStyle(el);
          const fontSizePt = (parseFloat(computed.fontSize) || 14.67) * 0.75;
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(fontSizePt);
          pdf.setTextColor(0, 0, 0);
          pdf.text(`${idx}.`, liCoords.xMm - 1.6, refCoords.yMm + refCoords.heightMm * 0.78, { align: 'right' });
        }
      } else if (tag === 'IMG' && el.complete && el.naturalWidth > 0) {
        try {
          const c = toPageCoords(rect);
          const imgCanvas = document.createElement('canvas');
          imgCanvas.width = el.naturalWidth;
          imgCanvas.height = el.naturalHeight;
          const ctx = imgCanvas.getContext('2d');
          ctx.drawImage(el, 0, 0);
          pdf.setPage(c.pageNum);
          pdf.addImage(imgCanvas.toDataURL('image/png'), 'PNG', c.xMm, c.yMm, c.widthMm, c.heightMm);
        } catch (imgErr) {
          console.warn('Could not embed image in PDF:', imgErr);
        }
      }
    });

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const range = document.createRange();
    let textNode;

    while ((textNode = walker.nextNode())) {
      const parentEl = textNode.parentElement;
      if (!parentEl || parentEl.classList.contains('pdf-checkbox')) continue;

      const rawValue = textNode.nodeValue || '';
      if (!rawValue.trim()) continue;

      const computed = window.getComputedStyle(parentEl);
      const isMono = Boolean(parentEl.closest('code, pre, kbd'));
      const fontName = isMono ? 'courier' : 'helvetica';
      const isBold =
        parseInt(computed.fontWeight, 10) >= 600 ||
        computed.fontWeight === 'bold' ||
        Boolean(parentEl.closest('strong, b, h1, h2, h3, h4, h5, h6, th'));
      const isItalic =
        computed.fontStyle === 'italic' ||
        computed.fontStyle === 'oblique' ||
        Boolean(parentEl.closest('em, i'));
      const fontStyle = isBold && isItalic ? 'bolditalic' : isBold ? 'bold' : isItalic ? 'italic' : 'normal';
      const fontSizePt = (parseFloat(computed.fontSize) || 14.67) * 0.75;
      const [rCol, gCol, bCol] = parseRgbColor(computed.color);
      const isUppercase = computed.textTransform === 'uppercase';

      if (parentEl.closest('pre')) {
        const lines = rawValue.split('\n');
        let charOffset = 0;
        for (let i = 0; i < lines.length; i++) {
          const lineStr = lines[i];
          const lineLen = lineStr.length;
          if (lineStr.trim().length > 0) {
            range.setStart(textNode, charOffset);
            range.setEnd(textNode, charOffset + lineLen);
            const lineRect = range.getBoundingClientRect();
            if (lineRect.width > 0 && lineRect.height > 0) {
              const c = toPageCoords(lineRect);
              pdf.setPage(c.pageNum);
              pdf.setFont('courier', fontStyle);
              pdf.setFontSize(fontSizePt);
              pdf.setTextColor(rCol, gCol, bCol);
              pdf.text(toWinAnsiString(lineStr), c.xMm, c.yMm + c.heightMm * 0.78);
            }
          }
          charOffset += lineLen + 1;
        }
        continue;
      }

      const tokenRegex = /\S+/g;
      const wordTokens = [];
      let match;
      while ((match = tokenRegex.exec(rawValue)) !== null) {
        range.setStart(textNode, match.index);
        range.setEnd(textNode, match.index + match[0].length);
        const wordRect = range.getBoundingClientRect();
        if (wordRect.width > 0 && wordRect.height > 0) {
          wordTokens.push({
            start: match.index,
            end: match.index + match[0].length,
            rect: wordRect
          });
        }
      }

      if (wordTokens.length === 0) continue;

      const lines = [];
      let currentLine = [wordTokens[0]];
      for (let i = 1; i < wordTokens.length; i++) {
        const prev = currentLine[currentLine.length - 1];
        const curr = wordTokens[i];
        if (Math.abs(curr.rect.top - prev.rect.top) < 3) {
          currentLine.push(curr);
        } else {
          lines.push(currentLine);
          currentLine = [curr];
        }
      }
      lines.push(currentLine);

      const isUnderlined = Boolean(parentEl.closest('u, a'));
      const isStrikethrough = Boolean(parentEl.closest('del, s'));
      const linkEl = parentEl.closest('a[href]');

      lines.forEach((lineTokens) => {
        const first = lineTokens[0];
        const last = lineTokens[lineTokens.length - 1];
        let segmentStr = rawValue.substring(first.start, last.end).replace(/\s+/g, ' ');
        if (isUppercase) segmentStr = segmentStr.toUpperCase();

        const unionRect = {
          left: first.rect.left,
          top: Math.min(...lineTokens.map((t) => t.rect.top)),
          width: last.rect.right - first.rect.left,
          height: Math.max(...lineTokens.map((t) => t.rect.bottom)) - Math.min(...lineTokens.map((t) => t.rect.top))
        };

        const c = toPageCoords(unionRect);
        pdf.setPage(c.pageNum);
        pdf.setFont(fontName, fontStyle);
        pdf.setFontSize(fontSizePt);
        pdf.setTextColor(rCol, gCol, bCol);

        const baselineY = c.yMm + c.heightMm * 0.78;
        pdf.text(toWinAnsiString(segmentStr), c.xMm, baselineY);

        if (isUnderlined) {
          pdf.setDrawColor(rCol, gCol, bCol);
          pdf.setLineWidth(0.22);
          pdf.line(c.xMm, c.yMm + c.heightMm * 0.9, c.xMm + c.widthMm, c.yMm + c.heightMm * 0.9);
        }

        if (isStrikethrough) {
          pdf.setDrawColor(rCol, gCol, bCol);
          pdf.setLineWidth(0.22);
          pdf.line(c.xMm, c.yMm + c.heightMm * 0.52, c.xMm + c.widthMm, c.yMm + c.heightMm * 0.52);
        }

        if (linkEl && linkEl.href) {
          pdf.link(c.xMm, c.yMm, c.widthMm, c.heightMm, { url: linkEl.href });
        }
      });
    }
  }

  function exportPdf() {
    if (typeof html2pdf === 'undefined') {
      showToast('Error: html2pdf library not loaded.');
      return;
    }

    if (!markdownInput.value.trim()) {
      showToast('Cannot export an empty document.');
      return;
    }

    const filename = getDocumentFilename('pdf');
    const originalBtnHtml = btnExportPdf.innerHTML;

    btnExportPdf.disabled = true;
    btnExportPdf.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> <span>Exporting...</span>';
    showToast('Generating high-resolution vector PDF...');

    const pdfClone = markdownPreview.cloneNode(true);
    pdfClone.removeAttribute('id');

    const clonedCheckboxes = pdfClone.querySelectorAll('input[type="checkbox"]');
    clonedCheckboxes.forEach((cb) => {
      const box = document.createElement('span');
      const isChecked = cb.checked || cb.hasAttribute('checked');
      box.className = isChecked ? 'pdf-checkbox checked' : 'pdf-checkbox';
      box.textContent = isChecked ? '✓' : '';
      cb.parentNode.replaceChild(box, cb);
    });

    const opt = {
      margin:       [15, 15, 15, 15],
      filename:     filename,
      image:        { type: 'jpeg', quality: 1.0 },
      html2canvas:  {
        scale: 3,
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        backgroundColor: '#ffffff',
        onclone: (clonedDoc) => {
          ['.navbar', '.workspace-container', '.modal-backdrop', '.toast-container'].forEach((sel) => {
            const el = clonedDoc.querySelector(sel);
            if (el) el.style.display = 'none';
          });

          const overlay = clonedDoc.querySelector('.html2pdf__overlay');
          if (overlay) {
            overlay.style.opacity = '1';
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.right = '0';
            overlay.style.bottom = 'auto';
            overlay.style.height = 'auto';
            overlay.style.overflow = 'visible';
            overlay.style.background = '#ffffff';
          }

          const container = clonedDoc.querySelector('.html2pdf__container');
          if (container) {
            container.style.position = 'absolute';
            container.style.top = '0';
            container.style.left = '0';
            container.style.right = 'auto';
            container.style.margin = '0';
          }
        }
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
        compress: true
      },
      pagebreak: {
        mode: ['css', 'legacy'],
        avoid: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'pre', 'blockquote', 'table', 'img', '.task-list-item']
      }
    };

    const JsPDFConstructor = window.jspdf && window.jspdf.jsPDF;
    const useVectorEngine =
      typeof JsPDFConstructor === 'function' &&
      !hasUnsupportedVectorChars(markdownPreview.textContent || '');

    if (useVectorEngine) {
      let measureOverlay = null;
      try {
        measureOverlay = document.createElement('div');
        measureOverlay.className = 'html2pdf__overlay';
        measureOverlay.style.cssText =
          'position:fixed;top:0;left:0;width:210mm;opacity:0;pointer-events:none;z-index:-9999;overflow:visible;background:#ffffff;';

        const measureContainer = document.createElement('div');
        measureContainer.className = 'html2pdf__container';
        measureContainer.style.cssText =
          'width:180mm;max-width:180mm;margin:0;padding:0;background:#ffffff;color:#000000;box-sizing:border-box;';

        measureContainer.appendChild(pdfClone.cloneNode(true));
        measureOverlay.appendChild(measureContainer);
        document.body.appendChild(measureOverlay);

        const vectorPdf = new JsPDFConstructor(opt.jsPDF);
        renderDomToVectorPdf(measureContainer, vectorPdf, opt);

        document.body.removeChild(measureOverlay);
        measureOverlay = null;

        vectorPdf.save(filename);
        showToast(`Exported ${filename}`);
        btnExportPdf.disabled = false;
        btnExportPdf.innerHTML = originalBtnHtml;
        return;
      } catch (vectorErr) {
        console.warn('Vector PDF engine encountered an issue, falling back to high-DPI canvas engine:', vectorErr);
        if (measureOverlay && measureOverlay.parentNode) {
          measureOverlay.parentNode.removeChild(measureOverlay);
        }
      }
    }

    html2pdf()
      .set(opt)
      .from(pdfClone)
      .save()
      .then(() => {
        showToast(`Exported ${filename}`);
      })
      .catch((err) => {
        console.error('PDF generation error:', err);
        showToast('Failed to export PDF.');
      })
      .finally(() => {
        btnExportPdf.disabled = false;
        btnExportPdf.innerHTML = originalBtnHtml;
      });
  }

  function positionHeadingMenu() {
    if (!headingDropdownTrigger || !headingMenu) return;
    const rect = headingDropdownTrigger.getBoundingClientRect();
    const menuWidth = 224;
    const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
    const left = Math.min(Math.max(8, rect.left), maxLeft);
    headingMenu.style.top = `${rect.bottom + 4}px`;
    headingMenu.style.left = `${left}px`;
  }

  function setupHeadingDropdown() {
    if (!headingDropdown || !headingDropdownTrigger || !headingMenu) return;

    headingDropdownTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = headingDropdown.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        positionHeadingMenu();
        headingDropdown.classList.add('open');
        headingDropdownTrigger.setAttribute('aria-expanded', 'true');
      }
    });

    window.addEventListener('resize', () => {
      if (headingDropdown.classList.contains('open')) {
        positionHeadingMenu();
      }
    });

    const editorToolbar = editorPane ? editorPane.querySelector('.toolbar') : null;
    if (editorToolbar) {
      editorToolbar.addEventListener('scroll', () => {
        if (headingDropdown.classList.contains('open')) {
          positionHeadingMenu();
        }
      });
    }

    const items = headingMenu.querySelectorAll('.dropdown-item');
    items.forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const level = parseInt(item.dataset.heading, 10);
        applyHeadingLevel(level);
        closeAllDropdowns();
      });
    });

    document.addEventListener('click', (e) => {
      if (!headingDropdown.contains(e.target)) {
        closeAllDropdowns();
      }
    });
  }

  function closeAllDropdowns() {
    if (headingDropdown) {
      headingDropdown.classList.remove('open');
      headingDropdownTrigger.setAttribute('aria-expanded', 'false');
    }
  }

  function applyHeadingLevel(level) {
    const textarea = markdownInput;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = text.length;

    const currentLine = text.substring(lineStart, lineEnd);
    const cleanLine = currentLine.replace(/^#{1,6}\s*/, '');

    let newLine = '';
    if (level >= 1 && level <= 6) {
      newLine = `${'#'.repeat(level)} ${cleanLine}`;
    } else {
      newLine = cleanLine;
    }

    historyManager.recordState();
    textarea.setRangeText(newLine, lineStart, lineEnd, 'end');

    render();
    scheduleAutoSave();
    historyManager.recordState();
    textarea.focus();
  }

  function insertFormatting(prefix, suffix, defaultPlaceholder = '') {
    const textarea = markdownInput;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);

    historyManager.recordState();

    if (
      suffix &&
      selected.length >= prefix.length + suffix.length &&
      selected.startsWith(prefix) &&
      selected.endsWith(suffix)
    ) {
      const unwrapped = selected.slice(prefix.length, selected.length - suffix.length);
      textarea.setRangeText(unwrapped, start, end, 'select');
    } else if (
      suffix &&
      start >= prefix.length &&
      text.substring(start - prefix.length, start) === prefix &&
      text.substring(end, end + suffix.length) === suffix
    ) {
      textarea.setRangeText(selected, start - prefix.length, end + suffix.length, 'select');
    } else {
      const replacement = selected ? `${prefix}${selected}${suffix}` : `${prefix}${defaultPlaceholder}${suffix}`;
      textarea.setRangeText(replacement, start, end, 'end');

      if (!selected && defaultPlaceholder) {
        textarea.setSelectionRange(start + prefix.length, start + prefix.length + defaultPlaceholder.length);
      }
    }

    render();
    scheduleAutoSave();
    historyManager.recordState();
    textarea.focus();
  }

  function insertLinePrefix(prefix, defaultPlaceholder = '') {
    const textarea = markdownInput;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = text.length;

    const currentLine = text.substring(lineStart, lineEnd);
    historyManager.recordState();

    if (!currentLine.trim()) {
      const replacement = `${prefix}${defaultPlaceholder}`;
      textarea.setRangeText(replacement, lineStart, lineEnd, 'end');
      if (defaultPlaceholder) {
        textarea.setSelectionRange(lineStart + prefix.length, lineStart + replacement.length);
      }
    } else if (currentLine.startsWith(prefix)) {
      const unwrapped = currentLine.slice(prefix.length);
      textarea.setRangeText(unwrapped, lineStart, lineEnd, 'end');
    } else {
      const prefixed = `${prefix}${currentLine}`;
      textarea.setRangeText(prefixed, lineStart, lineEnd, 'end');
    }

    render();
    scheduleAutoSave();
    historyManager.recordState();
    textarea.focus();
  }

  function handleTabKey(e) {
    if (e.key !== 'Tab') return;

    e.preventDefault();
    const textarea = markdownInput;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    historyManager.recordState();

    if (!e.shiftKey) {
      textarea.setRangeText('  ', start, end, 'end');
    } else {
      const text = textarea.value;
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      if (text.substring(lineStart, lineStart + 2) === '  ') {
        textarea.setRangeText('', lineStart, lineStart + 2, 'start');
      } else if (text.charAt(lineStart) === '\t' || text.charAt(lineStart) === ' ') {
        textarea.setRangeText('', lineStart, lineStart + 1, 'start');
      }
    }

    render();
    scheduleAutoSave();
    historyManager.recordState();
  }

  function applyFormat(formatType) {
    switch (formatType) {
      case 'bold':
        insertFormatting('**', '**', 'bold text');
        break;
      case 'italic':
        insertFormatting('*', '*', 'italic text');
        break;
      case 'underline':
        insertFormatting('<u>', '</u>', 'underlined text');
        break;
      case 'strike':
        insertFormatting('~~', '~~', 'strikethrough text');
        break;
      case 'quote':
        insertLinePrefix('> ', 'Quote text');
        break;
      case 'code':
        insertFormatting('\n```\n', '\n```\n', '// code block');
        break;
      case 'link':
        insertFormatting('[', '](https://example.com)', 'link text');
        break;
      case 'ul':
        insertLinePrefix('- ', 'List item');
        break;
      case 'ol':
        insertLinePrefix('1. ', 'First item');
        break;
      case 'task':
        insertLinePrefix('- [ ] ', 'Task item');
        break;
      case 'table':
        const sampleTable = `\n| Column 1 | Column 2 | Column 3 |\n| :--- | :---: | ---: |\n| Item 1 | Item 2 | Item 3 |\n| Item 4 | Item 5 | Item 6 |\n`;
        insertFormatting(sampleTable, '');
        break;
      default:
        break;
    }
  }

  async function copyToClipboard(text, successMessage) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const tempTextarea = document.createElement('textarea');
        tempTextarea.value = text;
        tempTextarea.style.position = 'fixed';
        tempTextarea.style.opacity = '0';
        document.body.appendChild(tempTextarea);
        tempTextarea.select();
        document.execCommand('copy');
        document.body.removeChild(tempTextarea);
      }
      showToast(successMessage);
    } catch (err) {
      console.error('Copy failed:', err);
      showToast('Failed to copy to clipboard.');
    }
  }

  function showToast(message) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fa-solid fa-circle-info" aria-hidden="true"></i> <span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 2600);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function openClearModal() {
    clearModal.classList.add('active');
    btnCancelClear.focus();
  }

  function closeClearModal() {
    clearModal.classList.remove('active');
    markdownInput.focus();
  }

  function confirmClear() {
    historyManager.recordState();
    markdownInput.value = '';
    render();
    saveToLocalStorage('');
    historyManager.recordState();
    closeClearModal();
    showToast('Document cleared.');
  }

  function setupResizer() {
    if (!paneResizer) return;

    paneResizer.addEventListener('mousedown', () => {
      isDraggingResizer = true;
      paneResizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    paneResizer.addEventListener('dblclick', () => {
      editorPane.style.flex = '1 1 50%';
      previewPane.style.flex = '1 1 50%';
      showToast('Split view reset to 50/50.');
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDraggingResizer) return;
      const containerRect = workspaceContainer.getBoundingClientRect();
      const relativeX = e.clientX - containerRect.left;
      const totalWidth = containerRect.width;

      const percentage = (relativeX / totalWidth) * 100;
      if (percentage >= 20 && percentage <= 80) {
        editorPane.style.flex = `0 0 ${percentage}%`;
        previewPane.style.flex = `0 0 ${100 - percentage}%`;
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDraggingResizer) {
        isDraggingResizer = false;
        paneResizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  let isSyncScrollEnabled = true;
  let activeScrollSource = null;
  let scrollUnlockTimer = null;

  function setupSyncScroll() {
    if (!markdownInput || !previewBody) return;

    markdownInput.addEventListener('scroll', () => {
      if (!isSyncScrollEnabled || activeScrollSource === 'preview') return;
      activeScrollSource = 'editor';
      const maxEditorScroll = markdownInput.scrollHeight - markdownInput.clientHeight;
      const maxPreviewScroll = previewBody.scrollHeight - previewBody.clientHeight;
      if (maxEditorScroll > 0 && maxPreviewScroll > 0) {
        const ratio = markdownInput.scrollTop / maxEditorScroll;
        previewBody.scrollTop = ratio * maxPreviewScroll;
      }
      clearTimeout(scrollUnlockTimer);
      scrollUnlockTimer = setTimeout(() => {
        activeScrollSource = null;
      }, 60);
    });

    previewBody.addEventListener('scroll', () => {
      if (!isSyncScrollEnabled || activeScrollSource === 'editor') return;
      activeScrollSource = 'preview';
      const maxPreviewScroll = previewBody.scrollHeight - previewBody.clientHeight;
      const maxEditorScroll = markdownInput.scrollHeight - markdownInput.clientHeight;
      if (maxPreviewScroll > 0 && maxEditorScroll > 0) {
        const ratio = previewBody.scrollTop / maxPreviewScroll;
        markdownInput.scrollTop = ratio * maxEditorScroll;
      }
      clearTimeout(scrollUnlockTimer);
      scrollUnlockTimer = setTimeout(() => {
        activeScrollSource = null;
      }, 60);
    });

    if (btnSyncScroll) {
      btnSyncScroll.addEventListener('click', () => {
        isSyncScrollEnabled = !isSyncScrollEnabled;
        btnSyncScroll.classList.toggle('active', isSyncScrollEnabled);
        btnSyncScroll.setAttribute('aria-pressed', String(isSyncScrollEnabled));
        showToast(isSyncScrollEnabled ? 'Synchronized scrolling enabled.' : 'Synchronized scrolling disabled.');
      });
    }
  }

  function setupMobileViewSwitcher() {
    if (!viewSwitcher) return;

    const buttons = viewSwitcher.querySelectorAll('.view-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        const view = btn.dataset.view;
        workspaceContainer.setAttribute('data-mobile-view', view);
      });
    });

    workspaceContainer.setAttribute('data-mobile-view', 'split');
  }

  function bindEvents() {
    markdownInput.addEventListener('input', () => {
      render();
      scheduleAutoSave();
      historyManager.handleTyping();
    });

    markdownInput.addEventListener('keydown', handleTabKey);

    if (btnUndo) {
      btnUndo.addEventListener('click', () => {
        const ok = historyManager.undo();
        if (ok) showToast('Undo');
        markdownInput.focus();
      });
    }

    if (btnRedo) {
      btnRedo.addEventListener('click', () => {
        const ok = historyManager.redo();
        if (ok) showToast('Redo');
        markdownInput.focus();
      });
    }

    window.addEventListener('keydown', (e) => {
      const isMac = isMacSystem();
      const cmdOrCtrl = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
      const altOrOpt = e.altKey;
      const key = e.key.toLowerCase();
      const modName = isMac ? 'Cmd' : 'Ctrl';
      const altName = isMac ? 'Opt' : 'Alt';

      if (cmdOrCtrl && !e.shiftKey && key === 'z') {
        e.preventDefault();
        const ok = historyManager.undo();
        if (ok) showToast(`Undo (${modName} + Z)`);
        return;
      }

      if ((cmdOrCtrl && key === 'y') || (cmdOrCtrl && e.shiftKey && key === 'z')) {
        e.preventDefault();
        const ok = historyManager.redo();
        if (ok) showToast(`Redo (${isMac ? 'Cmd + Shift + Z' : 'Ctrl + Y'})`);
        return;
      }

      if (cmdOrCtrl && key === 's') {
        e.preventDefault();
        saveToLocalStorage(markdownInput.value);
        showToast(`Document saved (${modName} + S).`);
        return;
      }

      if ((cmdOrCtrl && altOrOpt) || (isMac && e.metaKey && e.altKey)) {
        if (e.key >= '1' && e.key <= '6') {
          e.preventDefault();
          const lvl = parseInt(e.key, 10);
          applyHeadingLevel(lvl);
          showToast(`Heading ${lvl} (${modName} + ${altName} + ${lvl})`);
          return;
        } else if (e.key === '0') {
          e.preventDefault();
          applyHeadingLevel(0);
          showToast(`Normal Text (${modName} + ${altName} + 0)`);
          return;
        }
      }

      if (cmdOrCtrl && document.activeElement === markdownInput) {
        if (key === 'b') {
          e.preventDefault();
          applyFormat('bold');
        } else if (key === 'i') {
          e.preventDefault();
          applyFormat('italic');
        } else if (key === 'u') {
          e.preventDefault();
          applyFormat('underline');
        } else if (key === 'k') {
          e.preventDefault();
          applyFormat('link');
        }
      }

      if (e.key === 'Escape') {
        closeAllDropdowns();
        if (clearModal.classList.contains('active')) {
          closeClearModal();
        }
      }
    });

    formatButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const format = btn.dataset.format;
        applyFormat(format);
      });
    });

    if (btnCopyRaw) {
      btnCopyRaw.addEventListener('click', () => {
        copyToClipboard(markdownInput.value, 'Raw Markdown copied to clipboard.');
      });
    }

    if (btnCopyHtml) {
      btnCopyHtml.addEventListener('click', () => {
        copyToClipboard(markdownPreview.innerHTML, 'Rendered HTML copied to clipboard.');
      });
    }

    btnClear.addEventListener('click', openClearModal);
    btnCancelClear.addEventListener('click', closeClearModal);
    btnConfirmClear.addEventListener('click', confirmClear);

    clearModal.addEventListener('click', (e) => {
      if (e.target === clearModal) {
        closeClearModal();
      }
    });

    btnExportMd.addEventListener('click', exportMarkdown);
    btnExportPdf.addEventListener('click', exportPdf);

    markdownInput.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    markdownInput.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!/\.(md|markdown|txt)$/i.test(file.name) && !file.type.startsWith('text/')) {
        return;
      }
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (typeof ev.target.result === 'string') {
          historyManager.recordState();
          markdownInput.value = ev.target.result;
          render();
          saveToLocalStorage(markdownInput.value);
          historyManager.recordState();
          showToast(`Loaded ${file.name}`);
        }
      };
      reader.readAsText(file);
    });

    setupSyncScroll();
    setupMobileViewSwitcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
