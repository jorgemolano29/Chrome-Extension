// ════════════════════════════════════════════════════════
//  VISASPRO — CONTENT.JS
// ════════════════════════════════════════════════════════

function fillInput(id, value) {
  const el = document.getElementById(id);
  if (!el || !value || value.trim() === '') return false;
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur',   { bubbles: true }));
  console.log(`[VP] fillInput  #${id} = "${value}"`);
  return true;
}

function fillSelect(id, value) {
  const el = document.getElementById(id);
  if (!el || !value) return false;
  const lv = value.toString().toLowerCase();
  for (const opt of el.options) {
    if (opt.value.toLowerCase() === lv || opt.text.toLowerCase() === lv) {
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[VP] fillSelect #${id} = "${opt.value}"`);
      return true;
    }
  }
  console.warn(`[VP] fillSelect #${id}: sin coincidencia para "${value}"`);
  return false;
}

function fillRadio(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.click();
  el.dispatchEvent(new Event('change', { bubbles: true }));
  console.log(`[VP] fillRadio  #${id}`);
  return true;
}

function fillCheckbox(id, check = true) {
  const el = document.getElementById(id);
  if (!el) return false;
  if (el.checked !== check) el.click();
  console.log(`[VP] fillCheck  #${id} = ${check}`);
  return true;
}

// Espera a que un elemento aparezca en el DOM (para campos dinámicos)
function waitFor(id, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const el = document.getElementById(id);
    if (el) { resolve(el); return; }
    const obs = new MutationObserver(() => {
      const found = document.getElementById(id);
      if (found) { obs.disconnect(); resolve(found); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); reject(new Error('Timeout: ' + id)); }, timeout);
  });
}


// ── PI1 ─────────────────────────────────────────────────

function fillPI1(data) {
  let ok = 0;

  if (fillInput('ctl00_SiteContentPlaceHolder_FormView1_tbxAPP_SURNAME',    data.lastName))  ok++;
  if (fillInput('ctl00_SiteContentPlaceHolder_FormView1_tbxAPP_GIVEN_NAME', data.firstName)) ok++;

  fillCheckbox('ctl00_SiteContentPlaceHolder_FormView1_cbexAPP_FULL_NAME_NATIVE_NA', true);
  fillRadio('ctl00_SiteContentPlaceHolder_FormView1_rblOtherNames_1');
  fillRadio('ctl00_SiteContentPlaceHolder_FormView1_rblTelecodeQuestion_1');

  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlAPP_GENDER',         data.gender))        ok++;
  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlAPP_MARITAL_STATUS', data.maritalStatus)) ok++;

  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlDOBDay',   data.dob_day))   ok++;
  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlDOBMonth', data.dob_month)) ok++;
  if (fillInput( 'ctl00_SiteContentPlaceHolder_FormView1_tbxDOBYear',  data.dob_year))  ok++;

  if (fillInput('ctl00_SiteContentPlaceHolder_FormView1_tbxAPP_POB_CITY',        data.birthCity))  ok++;
  if (fillInput('ctl00_SiteContentPlaceHolder_FormView1_tbxAPP_POB_ST_PROVINCE', data.birthState)) ok++;
  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlAPP_POB_CNTRY',      data.nationality)) ok++;

  console.log(`[VP] PI1 completado: ${ok} campos`);
  return ok;
}


// ── PI2 ─────────────────────────────────────────────────

function fillPI2(data) {
  let ok = 0;

  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlAPP_NATL', 'MEX')) ok++;
  if (fillRadio('ctl00_SiteContentPlaceHolder_FormView1_rblAPP_OTH_NATL_IND_1'))       ok++;
  if (fillRadio('ctl00_SiteContentPlaceHolder_FormView1_rblPermResOtherCntryInd_1'))   ok++;

  if (data.curp) {
    fillCheckbox('ctl00_SiteContentPlaceHolder_FormView1_cbexAPP_NATIONAL_ID_NA', false);
    if (fillInput('ctl00_SiteContentPlaceHolder_FormView1_tbxAPP_NATIONAL_ID', data.curp)) ok++;
  }

  fillCheckbox('ctl00_SiteContentPlaceHolder_FormView1_cbexAPP_SSN_NA',    true);
  fillCheckbox('ctl00_SiteContentPlaceHolder_FormView1_cbexAPP_TAX_ID_NA', true);

  console.log(`[VP] PI2 completado: ${ok} campos`);
  return ok;
}


// ── TRAVEL ───────────────────────────────────────────────

async function fillTravel(data) {
  let ok = 0;

  // Propósito del viaje — siempre B (Tourism/Pleasure)
  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_dlPrincipalAppTravel_ctl00_ddlPurposeOfTrip', 'B')) ok++;

  // Sub-propósito — siempre B1-B2
  try { await waitFor('ctl00_SiteContentPlaceHolder_FormView1_dlPrincipalAppTravel_ctl00_ddlOtherPurpose'); } catch(e) {}
  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_dlPrincipalAppTravel_ctl00_ddlOtherPurpose', 'B1-B2')) ok++;

  // ¿Fechas específicas? → Y (dispara campos de fecha)
  fillRadio('ctl00_SiteContentPlaceHolder_FormView1_rblSpecificTravel_0');

  // Esperar a que aparezcan los campos de fecha
  try { await waitFor('ctl00_SiteContentPlaceHolder_FormView1_ddlTRAVEL_DTEDay'); } catch(e) {}

  // Fecha tentativa de viaje
  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlTRAVEL_DTEDay',   data.travelDate_day))   ok++;
  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlTRAVEL_DTEMonth', data.travelDate_month)) ok++;
  if (fillInput( 'ctl00_SiteContentPlaceHolder_FormView1_tbxTRAVEL_DTEYear',  data.travelDate_year))  ok++;

  // Duración del viaje
  if (fillInput( 'ctl00_SiteContentPlaceHolder_FormView1_tbxTRAVEL_LOS',      data.travelDurationNum))  ok++;
  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlTRAVEL_LOS_CD',   data.travelDurationUnit)) ok++;

  // Dirección de hospedaje en EUA
  if (fillInput( 'ctl00_SiteContentPlaceHolder_FormView1_tbxStreetAddress1',  data.travelStreet))  ok++;
  if (fillInput( 'ctl00_SiteContentPlaceHolder_FormView1_tbxCity',            data.travelCity))    ok++;
  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlTravelState',     data.travelState))   ok++;
  if (fillInput( 'ctl00_SiteContentPlaceHolder_FormView1_tbZIPCode',          data.travelZip))     ok++;

  // ¿Quién paga el viaje?
  if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlWhoIsPaying', data.travelPayer)) ok++;

  // Si el pagador es otra persona (no Self)
  if (data.travelPayer !== 'S') {
    try { await waitFor('ctl00_SiteContentPlaceHolder_FormView1_tbxPayerSurname'); } catch(e) {}

    if (fillInput( 'ctl00_SiteContentPlaceHolder_FormView1_tbxPayerSurname',   data.payerLastName))     ok++;
    if (fillInput( 'ctl00_SiteContentPlaceHolder_FormView1_tbxPayerGivenName', data.payerFirstName))    ok++;
    if (fillInput( 'ctl00_SiteContentPlaceHolder_FormView1_tbxPayerPhone',     data.payerPhone))        ok++;

    // Email pagador — marcar NA si no hay email
    fillCheckbox('ctl00_SiteContentPlaceHolder_FormView1_cbxDNAPAYER_EMAIL_ADDR_NA', true);

    if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlPayerRelationship', data.payerRelationship)) ok++;

    // Dirección del pagador — ¿es la misma que el solicitante?
    if (data.payerStreet) {
      // Dirección diferente → No
      fillRadio('ctl00_SiteContentPlaceHolder_FormView1_rblPayerAddrSameAsInd_1');
      try { await waitFor('ctl00_SiteContentPlaceHolder_FormView1_tbxPayerStreetAddress1'); } catch(e) {}
      if (fillInput('ctl00_SiteContentPlaceHolder_FormView1_tbxPayerStreetAddress1', data.payerStreet))        ok++;
      if (fillInput('ctl00_SiteContentPlaceHolder_FormView1_tbxPayerCity',           data.payerCity))          ok++;
      if (fillInput('ctl00_SiteContentPlaceHolder_FormView1_tbxPayerStateProvince',  data.payerState))         ok++;
      if (fillInput('ctl00_SiteContentPlaceHolder_FormView1_tbxPayerPostalZIPCode',  data.payerZip))           ok++;
      // País pagador — siempre MEX
      if (fillSelect('ctl00_SiteContentPlaceHolder_FormView1_ddlPayerCountry', 'MEX')) ok++;
    } else {
      // Misma dirección → Y
      fillRadio('ctl00_SiteContentPlaceHolder_FormView1_rblPayerAddrSameAsInd_0');
    }
  }

  console.log(`[VP] Travel completado: ${ok} campos`);
  return ok;
}


// ── Router ───────────────────────────────────────────────

const SECTION_HANDLERS = {
  pi1:      (data) => Promise.resolve(fillPI1(data)),
  pi2:      (data) => Promise.resolve(fillPI2(data)),
  travel:   fillTravel,
  passport: () => { console.warn('[VP] Passport pendiente'); return Promise.resolve(0); },
  contact:  () => { console.warn('[VP] Contact pendiente');  return Promise.resolve(0); },
  family:   () => { console.warn('[VP] Family pendiente');   return Promise.resolve(0); },
  work:     () => { console.warn('[VP] Work pendiente');     return Promise.resolve(0); },
};


// ── Listener ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'fill') return;

  chrome.storage.local.get('visasproClientData', async (result) => {
    const data = result.visasproClientData;
    if (!data) { sendResponse({ ok: false, error: 'No hay datos de cliente.' }); return; }

    const handler = SECTION_HANDLERS[message.section];
    if (!handler) { sendResponse({ ok: false, error: `Sección desconocida: ${message.section}` }); return; }

    try {
      const filled = await handler(data);
      sendResponse({ ok: true, filled });
    } catch (err) {
      console.error('[VP] Error:', err);
      sendResponse({ ok: false, error: err.message });
    }
  });

  return true;
});

console.log('[VisasPro] Content script activo en:', window.location.href);
