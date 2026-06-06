export function initSignaturePad(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const ctx = canvas.getContext('2d');
  let isDrawing = false;

  // Adjust for high DPI screens
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    // Set stroke styles
    ctx.strokeStyle = '#0f172a'; // Slate-900
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  resizeCanvas();

  // Draw helpers
  function getCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function startDrawing(e) {
    e.preventDefault();
    isDrawing = true;
    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function stopDrawing() {
    isDrawing = false;
  }

  // Event listeners for Mouse
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseleave', stopDrawing);

  // Event listeners for Touch (Mobile)
  canvas.addEventListener('touchstart', startDrawing, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  canvas.addEventListener('touchend', stopDrawing);

  return {
    clear: () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Redraw scaling settings
      const rect = canvas.getBoundingClientRect();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    },
    isEmpty: () => {
      // Check if canvas is clear
      const buffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
      return !buffer.some(color => color !== 0);
    },
    getDataUrl: () => {
      return canvas.toDataURL('image/png');
    },
    setDataUrl: (dataUrl) => {
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        const rect = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = dataUrl;
    },
    triggerResize: () => {
      resizeCanvas();
    }
  };
}
