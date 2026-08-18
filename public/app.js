const form = document.getElementById('verify-form');
const input = document.getElementById('phone-input');
const btn = document.getElementById('verify-btn');
const resultEl = document.getElementById('result');
const bannerEl = document.getElementById('banner');

function pillClass(rawType) {
  if (!rawType) return 'other';
  if (rawType === 'voip' || rawType === 'nonFixedVoip' || rawType === 'fixedVoip') return 'voip';
  if (rawType === 'mobile') return 'mobile';
  if (rawType === 'landline' || rawType === 'fixed_line') return 'landline';
  return 'other';
}

function row(label, value) {
  return `<div class="row"><span class="k">${label}</span><span class="v">${value}</span></div>`;
}

function showBanner(message, isError) {
  bannerEl.textContent = message;
  bannerEl.classList.remove('hidden');
  bannerEl.classList.toggle('error', Boolean(isError));
}

function hideBanner() {
  bannerEl.classList.add('hidden');
}

function render(data) {
  resultEl.classList.remove('hidden');
  hideBanner();

  if (!data.valid) {
    resultEl.innerHTML = `
      <div class="status">
        <span class="badge invalid">INVALID</span>
        <span class="number">${data.input}</span>
      </div>
      <div class="rows">${row('Reason', data.reason || 'Not a valid, in-service number.')}</div>
    `;
    return;
  }

  let rows = '';

  if (typeof data.isVoip === 'boolean') {
    rows += row(
      'VOIP?',
      data.isVoip
        ? '<span class="pill voip">YES — INTERNET PHONE</span>'
        : '<span class="pill landline">No</span>'
    );
  }

  if (data.type) {
    rows += row(
      'Line Type',
      `<span class="pill ${pillClass(data.type.raw)}">${data.type.label}</span>`
    );
  } else if (!data.setupNeeded) {
    rows += row('Line Type', '<span class="pill other">Unavailable</span>');
  }

  if (data.carrier) rows += row('Carrier', data.carrier);

  if (data.location) {
    const loc = [data.location.city, data.location.stateCode || data.location.state]
      .filter(Boolean)
      .join(', ');
    const label = data.accurate && !data.setupNeeded ? 'Location' : 'Originally Assigned To';
    rows += row(label, loc || '—');
  }

  if (data.risk && data.risk.level) {
    rows += row('Risk Level', data.risk.level.toUpperCase());
  }
  if (data.risk && data.risk.disposable) {
    rows += row('Disposable Number', '<span class="pill voip">YES</span>');
  }

  rows += row('Formatted', data.national);
  rows += row('Country', data.country || '—');

  const caveat =
    data.accurate && !data.setupNeeded
      ? ''
      : `<div class="caveat">
          Location reflects where the number was originally assigned, not necessarily
          the owner's current whereabouts (mobile numbers are portable).
        </div>`;

  resultEl.innerHTML = `
    <div class="status">
      <span class="badge valid">VALID</span>
      <span class="number">${data.national}</span>
    </div>
    <div class="rows">${rows}</div>
    ${caveat}
  `;

  if (data.setupNeeded) {
    showBanner(data.message, false);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = input.value.trim();
  if (!phone) return;

  btn.disabled = true;
  btn.textContent = 'Checking…';
  hideBanner();
  resultEl.classList.add('hidden');

  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();

    if (!res.ok) {
      showBanner(data.error || 'Something went wrong.', true);
    } else {
      render(data);
    }
  } catch (err) {
    showBanner('Could not reach the server. Check your connection.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify';
  }
});
