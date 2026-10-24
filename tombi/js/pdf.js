/* pdf.js — download an RTL report element as a printable A4 PDF. */
T.pdf = (() => {
  async function download(element, filename, button) {
    if (!element) throw new Error('לא נמצא תוכן ליצירת PDF');
    const oldContent = button ? button.innerHTML : '';
    const previousPosition = element.style.position;
    const previousLeft = element.style.left;
    const previousTop = element.style.top;
    const previousWidth = element.style.width;
    const previousZIndex = element.style.zIndex;
    if (button) {
      button.disabled = true;
      button.innerHTML = 'מכין PDF…';
    }
    element.classList.add('pdf-mode');
    const previousBackground = element.style.backgroundColor;
    const previousDirection = element.style.direction;
    element.style.backgroundColor = '#fff';
    element.style.direction = 'rtl';
    try {
      if (typeof window.html2pdf !== 'function') {
        const homeCardExport = element.parentElement === document.body;
        if (homeCardExport) {
          document.body.classList.add('pdf-fallback-home');
          element.style.position = 'static';
          element.style.left = 'auto';
          element.style.top = 'auto';
          element.style.width = '794px';
          element.style.zIndex = 'auto';
        }
        window.alert('אין חיבור לאינטרנט, נפתח חלון הדפסה. בוחרים שם "שמירה כ-PDF"');
        window.print();
        return;
      }
      const options = {
        margin: [12, 12, 12, 12],
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['.chart', 'tr', '.card'] },
      };
      await window.html2pdf().set(options).from(element).save();
    } finally {
      element.classList.remove('pdf-mode');
      element.style.backgroundColor = previousBackground;
      element.style.direction = previousDirection;
      element.style.position = previousPosition;
      element.style.left = previousLeft;
      element.style.top = previousTop;
      element.style.width = previousWidth;
      element.style.zIndex = previousZIndex;
      document.body.classList.remove('pdf-fallback-home');
      if (button) {
        button.disabled = false;
        button.innerHTML = oldContent;
      }
    }
  }

  return { download };
})();
