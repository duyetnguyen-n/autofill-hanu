// Use the controller's actual origin; never accept a URL from user input.
if (location.protocol === 'https:' || location.protocol === 'http:') {
  document.querySelectorAll('[data-site-origin]').forEach(element => {
    element.textContent = location.origin;
  });
}
