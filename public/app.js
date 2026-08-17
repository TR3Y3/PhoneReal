const form = document.getElementById('verify-form');
const input = document.getElementById('phone-input');
const btn = document.getElementById('verify-btn');
const resultEl = document.getElementById('result');
const bannerEl = document.getElementById('banner');

function pillClass(rawType) {
  if (!rawType) return 'other';
  if (rawType === 'voip' || rawType === 'nonFixedVoip' || rawType === 'fixedVoip') return 'voip';
  if (rawType === 'mobile') return 'mobile';
  if (rawType === 'landline') return 'landline';
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
    const loc = [data.location.city, data.location.stateCode].filter(Boolean).join(', ');
    rows += row('Originally Assigned To', loc || '—');
  }

  rows += row('Formatted', data.national);
  rows += row('Country', data.country || '—');

  resultEl.innerHTML = `
    <div class="status">
      <span class="badge valid">VALID</span>
      <span class="number">${data.national}</span>
    </div>
    <div class="rows">${rows}</div>
    <div class="caveat">
      Location reflects where the number was originally assigned, not necessarily
      the owner's current whereabouts (mobile numbers are portable).
    </div>
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
