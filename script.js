/* Gibsons Surveyors — front-end interactions
 * Self-contained: no backend. Enquiries are saved to localStorage and
 * a pre-filled email is opened to the business via mailto as a fallback.
 */
(function () {
  'use strict';

  var BUSINESS_EMAIL = 'andrew@gibsons-surveyors.ltd';
  var STORAGE_KEY = 'gibsons_enquiries';

  /* ---- Current year in footer ---- */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---- Mobile navigation toggle ---- */
  var toggle = document.querySelector('.nav-toggle');
  var navList = document.getElementById('nav-list');
  if (toggle && navList) {
    toggle.addEventListener('click', function () {
      var open = navList.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    // Close the menu after selecting a link (mobile)
    navList.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        navList.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---- Enquiry form ---- */
  var form = document.getElementById('enquiry-form');
  var status = document.getElementById('form-status');
  if (!form) return;

  function showStatus(message, type) {
    if (!status) return;
    status.textContent = message;
    status.className = 'form-status ' + type;
    status.hidden = false;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function saveEnquiry(data) {
    try {
      var existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      existing.push(data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } catch (err) {
      // localStorage may be unavailable (private mode); non-fatal.
      console.warn('Could not save enquiry locally:', err);
    }
  }

  function buildMailto(data) {
    var subject = 'Survey enquiry — ' + (data.service || 'general') + (data.name ? ' (' + data.name + ')' : '');
    var lines = [
      'New survey enquiry from the website:',
      '',
      'Name: ' + data.name,
      'Email: ' + data.email,
      'Phone: ' + (data.phone || '—'),
      'Property address: ' + (data.address || '—'),
      'Survey type: ' + (data.service || 'Not sure — please advise'),
      'Property type: ' + (data.propertyType || '—'),
      '',
      'Message:',
      (data.message || '—'),
      '',
      'Submitted: ' + new Date(data.submittedAt).toLocaleString('en-GB')
    ];
    return 'mailto:' + BUSINESS_EMAIL +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(lines.join('\n'));
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var name = form.name.value.trim();
    var email = form.email.value.trim();

    // Reset previous validation styling
    [form.name, form.email].forEach(function (el) { el.classList.remove('invalid'); });

    var errors = [];
    if (!name) { errors.push('name'); form.name.classList.add('invalid'); }
    if (!email || !isValidEmail(email)) { errors.push('email'); form.email.classList.add('invalid'); }

    if (errors.length) {
      showStatus('Please add your ' + errors.join(' and a valid ') + ' so we can reply.', 'error');
      var firstBad = form.querySelector('.invalid');
      if (firstBad) firstBad.focus();
      return;
    }

    var data = {
      name: name,
      email: email,
      phone: form.phone.value.trim(),
      address: form.address.value.trim(),
      service: form.service.value,
      propertyType: form.propertyType.value,
      message: form.message.value.trim(),
      submittedAt: new Date().toISOString()
    };

    saveEnquiry(data);

    showStatus(
      'Thanks, ' + name.split(' ')[0] + '! Your enquiry has been recorded. ' +
      'Your email app should open so you can send it to us — or call 01268 949 100.',
      'success'
    );

    // Open a pre-filled email to the business (works without a backend).
    window.location.href = buildMailto(data);

    form.reset();
  });
})();
