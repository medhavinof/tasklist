const URL_SPLIT_PATTERN = /(https?:\/\/[^\s<>"']+)/g;
const BULLET_LINE_PATTERN = /^\s*[-*]\s+(.+)$/;

export function isImeComposing(event) {
  return Boolean(event.isComposing || event.keyCode === 229);
}

export function getLocalNowString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

function getDateShiftString(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDueBadge(dueAt, completed) {
  if (!dueAt) {
    return null;
  }

  const nowStr = getLocalNowString();
  const todayStr = nowStr.slice(0, 10);
  const tomorrowStr = getDateShiftString(1);
  const datePart = dueAt.slice(0, 10);
  const timePart = dueAt.slice(11, 16);

  const isOverdue = !completed && dueAt < nowStr;
  const isToday = datePart === todayStr;

  let labelDate = datePart;
  if (isToday) {
    labelDate = 'Hari ini';
  } else if (datePart === tomorrowStr) {
    labelDate = 'Besok';
  } else {
    const [y, m, d] = datePart.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    labelDate = parsed.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: y === new Date().getFullYear() ? undefined : 'numeric',
    });
  }

  const text = isOverdue
    ? `Terlambat · ${labelDate}, ${timePart}`
    : `${labelDate}, ${timePart}`;

  return {
    text,
    tone: isOverdue ? 'overdue' : isToday ? 'today' : 'normal',
  };
}

export function showMessage(element, message) {
  if (!message) {
    element.textContent = '';
    element.hidden = true;
    return;
  }
  element.textContent = message;
  element.hidden = false;
}

export function renderAvatarInto(element, avatarValue, fallbackName = '?') {
  element.innerHTML = '';
  if (avatarValue && avatarValue.startsWith('data:image/')) {
    const img = document.createElement('img');
    img.src = avatarValue;
    img.alt = `Avatar ${fallbackName}`;
    element.appendChild(img);
    return;
  }

  if (avatarValue && avatarValue.startsWith('emoji:')) {
    element.textContent = avatarValue.slice('emoji:'.length);
    return;
  }

  const initial = (fallbackName || '?').trim().charAt(0).toUpperCase() || '?';
  element.textContent = initial;
}

/**
 * Compresses an uploaded image file to max 256x256 JPEG/PNG data URL using canvas.
 */
export function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('File yang dipilih bukan gambar valid.'));
      img.onload = () => {
        const maxSide = 256;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function appendLinkedText(parent, text) {
  const parts = text.split(URL_SPLIT_PATTERN);
  for (const part of parts) {
    if (!part) {
      continue;
    }

    if (part.startsWith('http://') || part.startsWith('https://')) {
      const trailingMatch = /[.,;:!?)]+$/.exec(part);
      const urlText = trailingMatch ? part.slice(0, -trailingMatch[0].length) : part;
      const trailing = trailingMatch ? trailingMatch[0] : '';

      if (urlText.length > 'https://'.length) {
        const link = document.createElement('a');
        link.className = 'task-desc-link';
        link.href = urlText;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = urlText;
        parent.appendChild(link);
        if (trailing) {
          parent.appendChild(document.createTextNode(trailing));
        }
        continue;
      }
    }

    parent.appendChild(document.createTextNode(part));
  }
}

/**
 * Safely renders paragraphs, bullet lists, and clickable http(s) links using DOM nodes.
 */
export function renderFormattedDescription(container, descriptionText) {
  container.innerHTML = '';
  const lines = descriptionText.split('\n');
  let currentParagraphLines = [];
  let currentListEl = null;

  function flushParagraph() {
    if (currentParagraphLines.length === 0) {
      return;
    }
    const p = document.createElement('p');
    currentParagraphLines.forEach((line, index) => {
      if (index > 0) {
        p.appendChild(document.createElement('br'));
      }
      appendLinkedText(p, line);
    });
    container.appendChild(p);
    currentParagraphLines = [];
  }

  function flushList() {
    if (!currentListEl) {
      return;
    }
    container.appendChild(currentListEl);
    currentListEl = null;
  }

  for (const rawLine of lines) {
    const bulletMatch = BULLET_LINE_PATTERN.exec(rawLine);
    if (bulletMatch) {
      flushParagraph();
      if (!currentListEl) {
        currentListEl = document.createElement('ul');
      }
      const li = document.createElement('li');
      appendLinkedText(li, bulletMatch[1]);
      currentListEl.appendChild(li);
      continue;
    }

    if (rawLine.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    currentParagraphLines.push(rawLine);
  }

  flushParagraph();
  flushList();
}
