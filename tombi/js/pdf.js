/* pdf.js — print the live report as a selectable-text A4 document. */
T.pdf = (() => {
  function download(element, filename, button) {
    if (!element) throw new Error('לא נמצא תוכן ליצירת PDF');
    if (typeof window.print !== 'function') throw new Error('הדפסת מסמך אינה נתמכת בדפדפן הזה');

    const parent = element.parentNode;
    if (!parent) throw new Error('תוכן המסמך אינו מחובר לעמוד');
    const nextSibling = element.nextSibling;
    const oldTitle = document.title;
    const oldButtonContent = button ? button.innerHTML : '';
    const host = document.createElement('div');
    host.className = 'pdf-print-host';
    host.appendChild(element);
    document.body.appendChild(host);

    element.classList.add('pdf-mode');
    document.body.classList.add('pdf-print-active');
    document.title = filename.replace(/\.pdf$/i, '');
    if (button) {
      button.disabled = true;
      button.innerHTML = 'פותח תצוגת PDF…';
    }

    try {
      window.print();
    } finally {
      document.body.classList.remove('pdf-print-active');
      element.classList.remove('pdf-mode');
      document.title = oldTitle;
      parent.insertBefore(element, nextSibling && nextSibling.parentNode === parent ? nextSibling : null);
      host.remove();
      if (button) {
        button.disabled = false;
        button.innerHTML = oldButtonContent;
      }
    }
  }

  return { download };
})();
