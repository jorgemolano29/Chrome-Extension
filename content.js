// ════════════════════════════════════════════════════════
//  VISASPRO — CONTENT.JS  v1.15.0
// ════════════════════════════════════════════════════════

// ── Helpers ──────────────────────────────────────────────

function fillInput(id, value) {
  const el = document.getElementById(id);
  if (!el || !value || value.trim() === '') return false;

  // El atributo maxlength del HTML solo restringe lo que el usuario teclea, no una
  // asignación por script — sin este recorte, el DOM queda con un valor más largo del
  // que el formulario declara aceptar y CEAC lo rechaza al hacer "Next" (crash de
  // avance de página). Ver CONTEXTO_PROYECTO.md.
  let v = value;
  if (el.maxLength > 0 && v.length > el.maxLength) {
    console.warn(`[VP] fillInput #${id}: valor recortado de ${v.length} a ${el.maxLength} caracteres ("${v}")`);
    v = v.slice(0, el.maxLength);
  }

  el.focus(); el.value = v;
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur',   { bubbles: true }));
  console.log(`[VP] fillInput  #${id} = "${v}"`);
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
  el.checked = true;
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

// Los enlaces "Add Another" de los repetidores ASP.NET (idiomas, países visitados)
// usan href="javascript:__doPostBack('target','')". CEAC bloquea por CSP la
// ejecución de URLs javascript: cuando el .click() lo dispara un content script — la
// consola de DevTools no está sujeta a esa misma restricción, por eso un .click() de
// prueba ahí "sí funcionaba" mientras que desde la extensión no pasaba nada (sin
// error visible: el navegador solo bloquea la navegación en silencio). Se simula el
// postback manualmente vía fetch, igual que ya hace fillWork() para forzar la
// ocupación. Ver CONTEXTO_PROYECTO.md.
async function clickPostbackLink(el) {
  if (!el) return false;
  const href = el.getAttribute('href') || '';
  const match = href.match(/__doPostBack\('([^']*)'\s*,\s*'([^']*)'\)/);
  if (!match) { el.click(); return true; } // no es un postback conocido: fallback al clic normal

  const [, eventTarget, eventArgument] = match;
  const form = document.forms[0];
  const formData = new FormData(form);
  formData.set('__EVENTTARGET', eventTarget);
  formData.set('__EVENTARGUMENT', eventArgument);

  const response = await fetch(window.location.href, {
    method: 'POST',
    body: formData,
    credentials: 'include'
  });
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const newForm = doc.querySelector('#aspnetForm');
  const currentForm = document.querySelector('#aspnetForm');
  if (newForm && currentForm) currentForm.innerHTML = newForm.innerHTML;
  return true;
}

// ── Detecta valores "vacíos" semánticos ──────────────────
// Reutilizable en cualquier campo condicional
const BLANK_VALUES = new Set([
  'no aplica', 'no apply', 'n/a', 'na', 'ninguno', 'ninguna',
  'none', 'sin informacion', 'sin información', '-', '--', 'no',
]);

function isBlank(value) {
  if (!value) return true;
  return BLANK_VALUES.has(value.trim().toLowerCase());
}

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

// Espera a que un campo quede habilitado (ej. el campo de red social, que CEAC
// habilita ~1-2s después de elegir la plataforma). Usa polling — re-consulta el DOM
// por id en cada intento en vez de observar un nodo puntual — porque CEAC suele
// reemplazar el nodo completo vía un postback parcial (UpdatePanel de ASP.NET) en vez
// de solo cambiar el atributo disabled del mismo elemento; un MutationObserver atado
// al nodo viejo nunca se entera de que apareció uno nuevo con el mismo id.
function waitForEnabled(id, timeout = 5000, interval = 150) {
  return new Promise((resolve, reject) => {
    const tryFind = () => {
      const el = document.getElementById(id);
      return (el && !el.disabled) ? el : null;
    };
    const found = tryFind();
    if (found) { resolve(found); return; }
    const start = Date.now();
    const iv = setInterval(() => {
      const el = tryFind();
      if (el) { clearInterval(iv); resolve(el); return; }
      if (Date.now() - start > timeout) {
        clearInterval(iv);
        reject(new Error('Timeout esperando habilitar: ' + id));
      }
    }, interval);
  });
}

// Espera a que un elemento NUEVO aparezca en el DOM, con polling en vez de
// MutationObserver (más resistente que waitFor() para filas de repetidores
// agregadas vía "Add Another" — el postback que las crea puede tardar más de los 3s
// por defecto de waitFor(), y esa espera corta se agotaba en silencio antes de que
// la fila existiera, ver CONTEXTO_PROYECTO.md — idiomas/países de la sección Adicional).
function waitForExists(id, timeout = 8000, interval = 200) {
  return new Promise((resolve, reject) => {
    const found = document.getElementById(id);
    if (found) { resolve(found); return; }
    const start = Date.now();
    const iv = setInterval(() => {
      const el = document.getElementById(id);
      if (el) { clearInterval(iv); resolve(el); return; }
      if (Date.now() - start > timeout) {
        clearInterval(iv);
        reject(new Error('Timeout esperando aparecer: ' + id));
      }
    }, interval);
  });
}

const PH = 'ctl00_SiteContentPlaceHolder_FormView1_';
const id  = s => `${PH}${s}`;


// ── PI1 — Información Personal 1 ────────────────────────

function fillPI1(data) {
  let ok = 0;
  if (fillInput(id('tbxAPP_SURNAME'),    data.lastName))  ok++;
  if (fillInput(id('tbxAPP_GIVEN_NAME'), data.firstName)) ok++;
  fillCheckbox(id('cbexAPP_FULL_NAME_NATIVE_NA'), true);
  fillRadio(id('rblOtherNames_1'));
  fillRadio(id('rblTelecodeQuestion_1'));
  if (fillSelect(id('ddlAPP_GENDER'),         data.gender))        ok++;
  if (fillSelect(id('ddlAPP_MARITAL_STATUS'), data.maritalStatus)) ok++;
  if (fillSelect(id('ddlDOBDay'),   data.dob_day))   ok++;
  if (fillSelect(id('ddlDOBMonth'), data.dob_month)) ok++;
  if (fillInput( id('tbxDOBYear'),  data.dob_year))  ok++;
  if (fillInput( id('tbxAPP_POB_CITY'),        data.birthCity))   ok++;
  if (isBlank(data.birthState)) {
    fillCheckbox(id('cbexAPP_POB_ST_PROVINCE_NA'), true);
  } else if (fillInput(id('tbxAPP_POB_ST_PROVINCE'), data.birthState)) {
    ok++;
  }
  if (fillSelect(id('ddlAPP_POB_CNTRY'),       data.birthCountryRegion)) ok++;
  console.log(`[VP] PI1: ${ok}`); return ok;
}


// ── PI2 — Información Personal 2 ────────────────────────

function fillPI2(data) {
  let ok = 0;
  if (fillSelect(id('ddlAPP_NATL'), 'MEX')) ok++;
  fillRadio(id('rblAPP_OTH_NATL_IND_1'));
  fillRadio(id('rblPermResOtherCntryInd_1'));
  if (data.curp) {
    fillCheckbox(id('cbexAPP_NATIONAL_ID_NA'), false);
    if (fillInput(id('tbxAPP_NATIONAL_ID'), data.curp)) ok++;
  }
  fillCheckbox(id('cbexAPP_SSN_NA'),    true);
  fillCheckbox(id('cbexAPP_TAX_ID_NA'), true);
  console.log(`[VP] PI2: ${ok}`); return ok;
}


// ── TRAVEL — Información de Viaje ───────────────────────

// Regla de negocio (2026-08-11): si el PDF no trae NINGUNO de los 4 campos de la
// dirección de hospedaje en EUA, se usa esta dirección por defecto en vez de dejar
// el bloque vacío (CEAC no deja avanzar sin esta dirección). Se avisa en pantalla
// cuando esto ocurre — ver CONTEXTO_PROYECTO.md.
const DEFAULT_TRAVEL_ADDRESS = {
  street: '1921 S 10th St',
  city:   'McAllen',
  state:  'TX',
  zip:    '78503',
};

async function fillTravel(data) {
  let ok = 0;
  const notices = [];
  if (fillSelect(id('dlPrincipalAppTravel_ctl00_ddlPurposeOfTrip'), 'B')) ok++;
  try { await waitFor(id('dlPrincipalAppTravel_ctl00_ddlOtherPurpose')); } catch(e) {}
  if (fillSelect(id('dlPrincipalAppTravel_ctl00_ddlOtherPurpose'), 'B1-B2')) ok++;
  fillRadio(id('rblSpecificTravel_1'));
  try { await waitFor(id('ddlTRAVEL_DTEDay')); } catch(e) {}
  if (fillSelect(id('ddlTRAVEL_DTEDay'),   data.travelDate_day))   ok++;
  if (fillSelect(id('ddlTRAVEL_DTEMonth'), data.travelDate_month)) ok++;
  if (fillInput( id('tbxTRAVEL_DTEYear'),  data.travelDate_year))  ok++;
  if (fillInput( id('tbxTRAVEL_LOS'),      data.travelDurationNum))  ok++;
  if (fillSelect(id('ddlTRAVEL_LOS_CD'),   data.travelDurationUnit)) ok++;
  try { await waitFor(id('tbxStreetAddress1')); } catch(e) {}

  let travelStreet = data.travelStreet, travelCity = data.travelCity,
      travelState  = data.travelState,  travelZip  = data.travelZip;
  if (isBlank(travelStreet) && isBlank(travelCity) && isBlank(travelState) && isBlank(travelZip)) {
    ({ street: travelStreet, city: travelCity, state: travelState, zip: travelZip } = DEFAULT_TRAVEL_ADDRESS);
    notices.push('Se usó la dirección de hospedaje por defecto (McAllen, TX) porque el PDF no la traía.');
    console.warn('[VP] Travel: dirección de hospedaje vacía en el PDF — se usó la dirección por defecto.');
  }
  if (fillInput( id('tbxStreetAddress1'),  travelStreet)) ok++;
  if (fillInput( id('tbxCity'),            travelCity))   ok++;
  if (fillSelect(id('ddlTravelState'),     travelState))  ok++;
  if (fillInput( id('tbZIPCode'),          travelZip))    ok++;
  if (fillSelect(id('ddlWhoIsPaying'), data.travelPayer)) ok++;
  if (data.travelPayer !== 'S') {
    try { await waitFor(id('tbxPayerSurname')); } catch(e) {}
    if (fillInput( id('tbxPayerSurname'),   data.payerLastName))   ok++;
    if (fillInput( id('tbxPayerGivenName'), data.payerFirstName))  ok++;
    if (fillInput( id('tbxPayerPhone'),     data.payerPhone))      ok++;
    fillCheckbox(id('cbxDNAPAYER_EMAIL_ADDR_NA'), true);
    if (fillSelect(id('ddlPayerRelationship'), data.payerRelationship)) ok++;
    if (data.payerStreet && !isBlank(data.payerStreet)) {
      fillRadio(id('rblPayerAddrSameAsInd_1'));
      try { await waitFor(id('tbxPayerStreetAddress1')); } catch(e) {}
      if (fillInput( id('tbxPayerStreetAddress1'), data.payerStreet)) ok++;
      if (fillInput( id('tbxPayerCity'),            data.payerCity))  ok++;
      if (fillInput( id('tbxPayerStateProvince'),   data.payerState)) ok++;
      if (fillInput( id('tbxPayerPostalZIPCode'),   data.payerZip))   ok++;
      if (fillSelect(id('ddlPayerCountry'), 'MEX')) ok++;
    } else {
      fillRadio(id('rblPayerAddrSameAsInd_0'));
    }
  }
  console.log(`[VP] Travel: ${ok}`); return { count: ok, notices };
}


// ── COMPANIONS — Acompañantes ────────────────────────────

async function fillCompanions(data) {
  let ok = 0;
  try { await waitFor(id('rblOtherPersonsTravelingWithYou_0')); } catch(e) {}
  if (data.companionFirstName && !isBlank(data.companionFirstName)) {
    fillRadio(id('rblOtherPersonsTravelingWithYou_0'));
  } else {
    fillRadio(id('rblOtherPersonsTravelingWithYou_1'));
  }
  try { await waitFor(id('rblGroupTravel_1')); } catch(e) {}
  fillRadio(id('rblGroupTravel_1'));

  if (data.companionFirstName && !isBlank(data.companionFirstName)) {
    try { await waitFor(id('dlTravelCompanions_ctl00_tbxGivenName')); } catch(e) {}
    if (fillInput( id('dlTravelCompanions_ctl00_tbxGivenName'), data.companionFirstName))         ok++;
    if (fillInput( id('dlTravelCompanions_ctl00_tbxSurname'),   data.companionLastName))          ok++;
    if (fillSelect(id('dlTravelCompanions_ctl00_ddlTCRelationship'), data.companionRelationship)) ok++;
  }
  console.log(`[VP] Companions: ${ok}`); return ok;
}


// ── PREV TRAVEL — Viajes Previos a USA ──────────────────

async function fillPrevTravel(data) {
  let ok = 0;

  // ¿Viaje previo a EUA?
  if (data.prevTravel_day && !isBlank(data.prevTravel_day)) {
    fillRadio(id('rblPREV_US_TRAVEL_IND_0'));
    try { await waitFor(id('dtlPREV_US_VISIT_ctl00_ddlPREV_US_VISIT_DTEDay')); } catch(e) {}
    if (fillSelect(id('dtlPREV_US_VISIT_ctl00_ddlPREV_US_VISIT_DTEDay'),   data.prevTravel_day))         ok++;
    if (fillSelect(id('dtlPREV_US_VISIT_ctl00_ddlPREV_US_VISIT_DTEMonth'), data.prevTravel_month))       ok++;
    if (fillInput( id('dtlPREV_US_VISIT_ctl00_tbxPREV_US_VISIT_DTEYear'),  data.prevTravel_year))        ok++;
    if (fillInput( id('dtlPREV_US_VISIT_ctl00_tbxPREV_US_VISIT_LOS'),      data.prevTravelDurationNum))  ok++;
    if (fillSelect(id('dtlPREV_US_VISIT_ctl00_ddlPREV_US_VISIT_LOS_CD'),   data.prevTravelDurationUnit)) ok++;
  } else {
    fillRadio(id('rblPREV_US_TRAVEL_IND_1'));
  }

  // Licencia de manejo — siempre No
  fillRadio(id('rblPREV_US_DRIVER_LIC_IND_1'));

  // ¿Visa previa?
  if (data.visaIssue_day && !isBlank(data.visaIssue_day)) {
    fillRadio(id('rblPREV_VISA_IND_0'));
    try { await waitFor(id('ddlPREV_VISA_ISSUED_DTEDay')); } catch(e) {}
    if (fillSelect(id('ddlPREV_VISA_ISSUED_DTEDay'),   data.visaIssue_day))   ok++;
    if (fillSelect(id('ddlPREV_VISA_ISSUED_DTEMonth'), data.visaIssue_month)) ok++;
    if (fillInput( id('tbxPREV_VISA_ISSUED_DTEYear'),  data.visaIssue_year))  ok++;
    if (fillInput( id('tbxPREV_VISA_FOIL_NUMBER'),     data.visaNumber))      ok++;
    fillRadio(id('rblPREV_VISA_SAME_TYPE_IND_0'));
    fillRadio(id('rblPREV_VISA_SAME_CNTRY_IND_0'));
    fillRadio(id('rblPREV_VISA_TEN_PRINT_IND_0'));

    // ¿Extravío de visa?
    if (data.visaLostYear && !isBlank(data.visaLostYear)) {
      fillRadio(id('rblPREV_VISA_LOST_IND_0'));
      try { await waitFor(id('tbxPREV_VISA_LOST_YEAR')); } catch(e) {}
      if (fillInput(id('tbxPREV_VISA_LOST_YEAR'), data.visaLostYear))        ok++;
      if (fillInput(id('tbxPREV_VISA_LOST_EXPL'), data.visaLostExplanation)) ok++;
    } else {
      fillRadio(id('rblPREV_VISA_LOST_IND_1'));
    }

  } else {
    fillRadio(id('rblPREV_VISA_IND_1'));
  }

  // ¿Rechazo de visa? — siempre visible
  if (data.visaRefusedExplanation && !isBlank(data.visaRefusedExplanation)) {
    fillRadio(id('rblPREV_VISA_REFUSED_IND_0'));
    try { await waitFor(id('tbxPREV_VISA_REFUSED_EXPL')); } catch(e) {}
    if (fillInput(id('tbxPREV_VISA_REFUSED_EXPL'), data.visaRefusedExplanation)) ok++;
  } else {
    try { await waitFor(id('rblPREV_VISA_REFUSED_IND_1')); } catch(e) {}
    fillRadio(id('rblPREV_VISA_REFUSED_IND_1'));
  }

  // ¿Cancelación/revocación de visa? — el PDF de VisasPro NO tiene ninguna pregunta
  // sobre esto (es legalmente distinta de "rechazo de visa"). Decisión del usuario
  // (2026-08-11): siempre "No" hasta que VisasPro agregue esta pregunta a su PDF —
  // no hay base real para responder "Sí" sin que el cliente la haya confirmado.
  fillRadio(id('rblPREV_VISA_CANCELLED_IND_1'));

  // Petición IV — siempre No
  fillRadio(id('rblIV_PETITION_IND_1'));

  console.log(`[VP] PrevTravel: ${ok}`); return ok;
}

// ── ADDRESS — Dirección ──────────────────────────────────

async function fillAddress(data) {
  let ok = 0;
  if (fillInput( id('tbxAPP_ADDR_LN1'),      data.street)) ok++;
  if (fillInput( id('tbxAPP_ADDR_CITY'),      data.city))   ok++;
  if (isBlank(data.state)) {
    fillCheckbox(id('cbexAPP_ADDR_STATE_NA'), true);
  } else if (fillInput(id('tbxAPP_ADDR_STATE'), data.state)) {
    ok++;
  }
  if (fillSelect(id('ddlCountry'), 'MEX'))                  ok++;
  if (isBlank(data.zip)) {
    fillCheckbox(id('cbexAPP_ADDR_POSTAL_CD_NA'), true);
  } else if (fillInput(id('tbxAPP_ADDR_POSTAL_CD'), data.zip)) {
    ok++;
  }
  fillRadio(id('rblMailingAddrSame_0'));
  if (fillInput(id('tbxAPP_HOME_TEL'), data.phone)) ok++;
  fillCheckbox(id('cbexAPP_MOBILE_TEL_NA'), true);
  fillCheckbox(id('cbexAPP_BUS_TEL_NA'),    true);
  fillRadio(id('rblAddPhone_1'));
  if (fillInput(id('tbxAPP_EMAIL_ADDR'), data.email)) ok++;
  fillRadio(id('rblAddEmail_1'));
  if (data.socialNetwork && data.socialNetwork !== 'NONE') {
    if (fillSelect(id('dtlSocial_ctl00_ddlSocialMedia'), data.socialNetwork)) ok++;
    // CEAC habilita este campo vía AJAX 1-2s después de elegir la red social — un
    // delay fijo se quedaba corto a veces y el campo quedaba vacío. Se espera a que
    // el atributo disabled realmente desaparezca en vez de adivinar un tiempo fijo.
    try {
      await waitForEnabled(id('dtlSocial_ctl00_tbxSocialMediaIdent'));
      if (fillInput(id('dtlSocial_ctl00_tbxSocialMediaIdent'), data.socialHandle)) ok++;
    } catch (e) {
      console.warn('[VP] Address: el campo de red social no se habilitó a tiempo.', e);
    }
  }
  fillRadio(id('rblAddSocial_1'));
  console.log(`[VP] Address: ${ok}`); return ok;
}


// ── PASSPORT — Pasaporte ─────────────────────────────────

async function fillPassport(data) {
  let ok = 0;
  if (fillSelect(id('ddlPPT_TYPE'), 'R')) ok++;
  if (fillInput(id('tbxPPT_NUM'), data.passportNumber)) ok++;
  fillCheckbox(id('cbexPPT_BOOK_NUM_NA'), true);
  if (fillSelect(id('ddlPPT_ISSUED_CNTRY'), 'MEX'))    ok++;
  if (fillInput( id('tbxPPT_ISSUED_IN_CITY'),  data.passportCity))  ok++;
  if (fillInput( id('tbxPPT_ISSUED_IN_STATE'), data.passportState)) ok++;
  if (fillSelect(id('ddlPPT_ISSUED_IN_CNTRY'), 'MEX')) ok++;
  if (fillSelect(id('ddlPPT_ISSUED_DTEDay'),   data.passportIssue_day))   ok++;
  if (fillSelect(id('ddlPPT_ISSUED_DTEMonth'), data.passportIssue_month)) ok++;
  if (fillInput( id('tbxPPT_ISSUEDYear'),      data.passportIssue_year))  ok++;
  if (fillSelect(id('ddlPPT_EXPIRE_DTEDay'),   data.passportExpiry_day))   ok++;
  if (fillSelect(id('ddlPPT_EXPIRE_DTEMonth'), data.passportExpiry_month)) ok++;
  if (isBlank(data.passportExpiry_year)) {
    fillCheckbox(id('cbxPPT_EXPIRE_NA'), true);
  } else if (fillInput(id('tbxPPT_EXPIREYear'), data.passportExpiry_year)) {
    ok++;
  }

  // ¿Robo/extravío de pasaporte? — depende solo de la explicación (es la señal real
  // de que sí ocurrió). El número puede no conocerse — en ese caso se marca "Do Not
  // Know" en vez de dejar la pregunta entera en "No" por falta del número.
  if (data.passportLostExplanation && !isBlank(data.passportLostExplanation)) {
    fillRadio(id('rblLOST_PPT_IND_0'));
    try { await waitFor(id('dtlLostPPT_ctl00_tbxLOST_PPT_NUM')); } catch(e) {}
    if (data.passportLostNumber && !isBlank(data.passportLostNumber)) {
      if (fillInput(id('dtlLostPPT_ctl00_tbxLOST_PPT_NUM'), data.passportLostNumber)) ok++;
    } else {
      fillCheckbox(id('dtlLostPPT_ctl00_cbxLOST_PPT_NUM_UNKN_IND'), true);
    }
    if (fillSelect(id('dtlLostPPT_ctl00_ddlLOST_PPT_NATL'), 'MEX'))                         ok++;
    if (fillInput( id('dtlLostPPT_ctl00_tbxLOST_PPT_EXPL'), data.passportLostExplanation))  ok++;
  } else {
    fillRadio(id('rblLOST_PPT_IND_1'));
  }
  console.log(`[VP] Passport: ${ok}`); return ok;
}


// ── CONTACT — Dirección de Contacto en los EUA ──────────

// Regla de negocio (2026-08-11): si el PDF no trae NI persona de contacto NI hotel en
// EUA, se usa esta información por defecto en vez de dejar la sección vacía — CEAC
// exige un contacto obligatoriamente (nombre/hotel, parentesco, dirección completa) y
// no deja avanzar sin él. Se avisa en pantalla cuando esto ocurre.
const DEFAULT_US_CONTACT = {
  hotel:        'Wyndham Garden McAllen',
  relationship: 'OTHER',
  street:       '1921 S 10th St',
  city:         'McAllen',
  state:        'TX',
  zip:          '78503',
  phone:        '19569940505',
};

async function fillContact(data) {
  let ok = 0;
  const notices = [];

  const noPerson = isBlank(data.usContactFirstName) && isBlank(data.usContactLastName);
  const noHotel  = isBlank(data.usContactHotel);

  let hotel = data.usContactHotel, firstName = data.usContactFirstName,
      lastName = data.usContactLastName, relationship = data.usContactRelationship,
      street = data.usContactStreet, city = data.usContactCity,
      state = data.usContactState, zip = data.usContactZip, phone = data.usContactPhone;

  if (noPerson && noHotel) {
    ({ hotel, relationship, street, city, state, zip, phone } = DEFAULT_US_CONTACT);
    notices.push('Se usó un contacto en EUA por defecto (Wyndham Garden McAllen, TX) porque el PDF no traía persona ni hotel de contacto.');
    console.warn('[VP] Contact: sin persona/hotel en el PDF — se usó contacto por defecto.');
  }

  // Primero llenar nombre o hotel
  if (hotel && !isBlank(hotel)) {
    fillCheckbox(id('cbxUS_POC_NAME_NA'), true);
    if (fillInput(id('tbxUS_POC_ORGANIZATION'), hotel)) ok++;
    fillCheckbox(id('cbxUS_POC_ORG_NA_IND'), false);
  } else {
    if (fillInput(id('tbxUS_POC_GIVEN_NAME'), firstName)) ok++;
    if (fillInput(id('tbxUS_POC_SURNAME'),    lastName))  ok++;
    fillCheckbox(id('cbxUS_POC_ORG_NA_IND'), true);
  }

  // Parentesco — este activa los campos de dirección
  if (fillSelect(id('ddlUS_POC_REL_TO_APP'), relationship)) ok++;
  try { await waitFor(id('tbxUS_POC_ADDR_LN1')); } catch(e) {}

  // Dirección
  if (fillInput( id('tbxUS_POC_ADDR_LN1'),       street)) ok++;
  if (fillInput( id('tbxUS_POC_ADDR_CITY'),      city))   ok++;
  if (fillSelect(id('ddlUS_POC_ADDR_STATE'),     state))  ok++;
  if (fillInput( id('tbxUS_POC_ADDR_POSTAL_CD'), zip))    ok++;
  if (fillInput( id('tbxUS_POC_HOME_TEL'),       phone))  ok++;
  fillCheckbox(id('cbexUS_POC_EMAIL_ADDR_NA'), true);

  console.log(`[VP] Contact: ${ok}`); return { count: ok, notices };
}


// ── FAMILY — Familia ─────────────────────────────────────

async function fillFamily(data) {
  let ok = 0;

  if (isBlank(data.fatherFirstName)) {
    fillCheckbox(id('cbxFATHER_GIVEN_NAME_UNK_IND'), true);
  } else if (fillInput(id('tbxFATHER_GIVEN_NAME'), data.fatherFirstName)) {
    ok++;
  }
  if (isBlank(data.fatherLastName)) {
    fillCheckbox(id('cbxFATHER_SURNAME_UNK_IND'), true);
  } else if (fillInput(id('tbxFATHER_SURNAME'), data.fatherLastName)) {
    ok++;
  }
  if (isBlank(data.fatherDob_year)) {
    fillCheckbox(id('cbxFATHER_DOB_UNK_IND'), true);
  } else {
    if (fillSelect(id('ddlFathersDOBDay'),   data.fatherDob_day))   ok++;
    if (fillSelect(id('ddlFathersDOBMonth'), data.fatherDob_month)) ok++;
    if (fillInput( id('tbxFathersDOBYear'),  data.fatherDob_year))  ok++;
  }
  fillRadio(id('rblFATHER_LIVE_IN_US_IND_1'));

  if (isBlank(data.motherFirstName)) {
    fillCheckbox(id('cbxMOTHER_GIVEN_NAME_UNK_IND'), true);
  } else if (fillInput(id('tbxMOTHER_GIVEN_NAME'), data.motherFirstName)) {
    ok++;
  }
  if (isBlank(data.motherLastName)) {
    fillCheckbox(id('cbxMOTHER_SURNAME_UNK_IND'), true);
  } else if (fillInput(id('tbxMOTHER_SURNAME'), data.motherLastName)) {
    ok++;
  }
  if (isBlank(data.motherDob_year)) {
    fillCheckbox(id('cbxMOTHER_DOB_UNK_IND'), true);
  } else {
    if (fillSelect(id('ddlMothersDOBDay'),   data.motherDob_day))   ok++;
    if (fillSelect(id('ddlMothersDOBMonth'), data.motherDob_month)) ok++;
    if (fillInput( id('tbxMothersDOBYear'),  data.motherDob_year))  ok++;
  }
  fillRadio(id('rblMOTHER_LIVE_IN_US_IND_1'));

  if (data.usRelativeFirstName && !isBlank(data.usRelativeFirstName) &&
      data.usRelativeLastName  && !isBlank(data.usRelativeLastName)) {
    fillRadio(id('rblUS_IMMED_RELATIVE_IND_0'));
    try { await waitFor(id('dlUSRelatives_ctl00_tbxUS_REL_GIVEN_NAME')); } catch(e) {}
    if (fillInput( id('dlUSRelatives_ctl00_tbxUS_REL_GIVEN_NAME'), data.usRelativeFirstName))    ok++;
    if (fillInput( id('dlUSRelatives_ctl00_tbxUS_REL_SURNAME'),    data.usRelativeLastName))     ok++;
    if (fillSelect(id('dlUSRelatives_ctl00_ddlUS_REL_TYPE'),       data.usRelativeRelationship)) ok++;
    if (fillSelect(id('dlUSRelatives_ctl00_ddlUS_REL_STATUS'),     data.usRelativeStatus))       ok++;
  } else {
    fillRadio(id('rblUS_IMMED_RELATIVE_IND_1'));
  }
  const hasOther = (data.hasOtherUSRelative || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const radioId = hasOther === 'SI' || hasOther === 'YES' || hasOther === 'S'
    ? 'rblUS_OTHER_RELATIVE_IND_0'
    : 'rblUS_OTHER_RELATIVE_IND_1';
  try { await waitFor(id(radioId)); } catch(e) {}
  fillRadio(id(radioId));
  console.log(`[VP] Family: ${ok}`); return ok;
}


// ── SPOUSE — Pareja ──────────────────────────────────────

async function fillSpouse(data) {
  let ok = 0;
  // Solo se ejecuta si hay datos de pareja (estado civil casado/unión libre)
  if (!data.spouseFirstName) {
    console.log('[VP] Spouse: sin datos de pareja'); return 0;
  }
  try { await waitFor(id('tbxSpouseGivenName')); } catch(e) {}
  if (fillInput( id('tbxSpouseGivenName'),      data.spouseFirstName))    ok++;
  if (fillInput( id('tbxSpouseSurname'),         data.spouseLastName))    ok++;
  // Decisión del usuario (2026-08-11): nacionalidad de la pareja siempre MEX, sin
  // depender del dato del PDF — mismo criterio que la nacionalidad del solicitante.
  if (fillSelect(id('ddlSpouseNatDropDownList'), 'MEX')) ok++;
  if (fillSelect(id('ddlDOBDay'),   data.spouseDob_day))   ok++;
  if (fillSelect(id('ddlDOBMonth'), data.spouseDob_month)) ok++;
  if (fillInput( id('tbxDOBYear'),  data.spouseDob_year))  ok++;
  if (isBlank(data.spouseBirthCity)) {
    fillCheckbox(id('cbexSPOUSE_POB_CITY_NA'), true);
  } else if (fillInput(id('tbxSpousePOBCity'), data.spouseBirthCity)) {
    ok++;
  }
  if (fillSelect(id('ddlSpousePOBCountry'),   data.spouseBirthCountry)) ok++;
  fillSelect(id('ddlSpouseAddressType'), 'H');
  console.log(`[VP] Spouse: ${ok}`); return ok;
}


// ── WORK — Trabajo actual ────────────────────────────────

// El dropdown ddlPresentOccupation ("Primary Occupation") del DS-160 real no tiene una
// opción genérica "Employed" — solo categorías de industria + Student/Retired/Not
// Employed/Other. Los códigos reales confirmados contra el DOM (2026-08-11):
//   O = OTHER, S = STUDENT, RT = RETIRED, N = NOT EMPLOYED
// Coinciden exactamente con EQUIV.occupationCode de mappings.js. Antes, fillWork
// forzaba siempre 'O' sin importar la ocupación real del cliente — ver
// CONTEXTO_PROYECTO.md.
async function fillWork(data) {
  let ok = 0;
  const occCode = (data.occupation && !isBlank(data.occupation)) ? data.occupation : 'O';

  // Postback manual seleccionando la ocupación REAL del cliente (antes hardcodeado a
  // 'O'). Se dispara solo si el select no tiene ya ese valor — necesario porque para
  // RT/N nunca aparece tbxEmpSchName, así que no sirve como condición de disparo.
  const occSelect = document.getElementById(id('ddlPresentOccupation'));
  if (!occSelect || occSelect.value !== occCode) {
    const form = document.forms[0];
    const formData = new FormData(form);
    formData.set('__EVENTTARGET', 'ctl00$SiteContentPlaceHolder$FormView1$ddlPresentOccupation');
    formData.set('__EVENTARGUMENT', '');
    formData.set('ctl00$SiteContentPlaceHolder$FormView1$ddlPresentOccupation', occCode);

    const response = await fetch(window.location.href, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const newForm = doc.querySelector('#aspnetForm');
    const currentForm = document.querySelector('#aspnetForm');
    if (newForm && currentForm) {
      currentForm.innerHTML = newForm.innerHTML;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Campo "Explain" — solo aparece para O (Otro/Empleado) y N (Not Employed). Usa
  // data.occupationText (EMPLOYEE/UNEMPLOYED/OTHER), ya calculado en popup.js pero
  // antes nunca usado aquí — la lógica vieja siempre ponía "EMPLOYEE" o el código crudo.
  if (occCode === 'O' || occCode === 'N') {
    try { await waitFor(id('tbxExplainOtherPresentOccupation')); } catch(e) {}
    if (fillInput(id('tbxExplainOtherPresentOccupation'), data.occupationText)) ok++;
  }

  if (occCode === 'RT') {
    // Retirado: no hay ningún otro campo en esta página.
    console.log(`[VP] Work: ${ok}`); return ok;
  }
  if (occCode === 'N') {
    // Desempleado: solo el campo "Explain" de arriba.
    console.log(`[VP] Work: ${ok}`); return ok;
  }

  // O (Otro/Empleado) y S (Student) comparten el mismo bloque de campos, solo cambia
  // la etiqueta ("Present Employer or School Name") y de dónde sale el dato.
  try { await waitFor(id('tbxEmpSchName')); } catch(e) {}

  if (occCode === 'S') {
    if (fillInput(id('tbxEmpSchName'),  data.schoolName))   ok++;
    if (fillInput(id('tbxEmpSchAddr1'), data.schoolStreet)) ok++;
    if (fillInput(id('tbxEmpSchCity'),  data.schoolCity))   ok++;
    if (isBlank(data.schoolState)) {
      fillCheckbox(id('cbxWORK_EDUC_ADDR_STATE_NA'), true);
    } else if (fillInput(id('tbxWORK_EDUC_ADDR_STATE'), data.schoolState)) {
      ok++;
    }
    if (isBlank(data.schoolZip)) {
      fillCheckbox(id('cbxWORK_EDUC_ADDR_POSTAL_CD_NA'), true);
    } else if (fillInput(id('tbxWORK_EDUC_ADDR_POSTAL_CD'), data.schoolZip)) {
      ok++;
    }
    if (fillSelect(id('ddlEmpSchCountry'), data.schoolCountry || 'MEX')) ok++;
    if (fillSelect(id('ddlEmpDateFromDay'),   data.schoolStart_day))    ok++;
    if (fillSelect(id('ddlEmpDateFromMonth'), data.schoolStart_month))  ok++;
    if (fillInput( id('tbxEmpDateFromYear'),  data.schoolStart_year))   ok++;
    fillCheckbox(id('cbxCURR_MONTHLY_SALARY_NA'), true);
    if (fillInput(id('tbxDescribeDuties'), 'Student')) ok++;
  } else {
    if (fillInput(id('tbxEmpSchName'),  data.employer))   ok++;
    if (fillInput(id('tbxEmpSchAddr1'), data.workStreet)) ok++;
    if (fillInput(id('tbxEmpSchCity'),  data.workCity))   ok++;
    if (isBlank(data.workState)) {
      fillCheckbox(id('cbxWORK_EDUC_ADDR_STATE_NA'), true);
    } else if (fillInput(id('tbxWORK_EDUC_ADDR_STATE'), data.workState)) {
      ok++;
    }
    if (isBlank(data.workZip)) {
      fillCheckbox(id('cbxWORK_EDUC_ADDR_POSTAL_CD_NA'), true);
    } else if (fillInput(id('tbxWORK_EDUC_ADDR_POSTAL_CD'), data.workZip)) {
      ok++;
    }
    if (fillInput(id('tbxWORK_EDUC_TEL'), data.workPhone)) ok++;
    if (fillSelect(id('ddlEmpSchCountry'), 'MEX')) ok++;
    if (fillSelect(id('ddlEmpDateFromDay'),   data.workStart_day))   ok++;
    if (fillSelect(id('ddlEmpDateFromMonth'), data.workStart_month)) ok++;
    if (fillInput( id('tbxEmpDateFromYear'),  data.workStart_year))  ok++;
    if (data.workSalary && !isBlank(data.workSalary)) {
      if (fillInput(id('tbxCURR_MONTHLY_SALARY'), data.workSalary)) ok++;
    } else {
      fillCheckbox(id('cbxCURR_MONTHLY_SALARY_NA'), true);
    }
    if (fillInput(id('tbxDescribeDuties'), data.workDuties)) ok++;
  }

  console.log(`[VP] Work: ${ok}`); return ok;
}


// ── WORK PREV — Trabajo anterior / Estudios ─────────────

async function fillWorkPrev(data) {
  let ok = 0;
  if (data.prevEmployer) {
    fillRadio(id('rblPreviouslyEmployed_0'));
    try { await waitFor(id('dtlPrevEmpl_ctl00_tbEmployerName')); } catch(e) {}
    if (fillInput( id('dtlPrevEmpl_ctl00_tbEmployerName'),              data.prevEmployer))      ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbEmployerStreetAddress1'),    data.prevWorkStreet))    ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbEmployerCity'),              data.prevWorkCity))      ok++;
    if (isBlank(data.prevWorkState)) {
      fillCheckbox(id('dtlPrevEmpl_ctl00_cbxPREV_EMPL_ADDR_STATE_NA'), true);
    } else if (fillInput(id('dtlPrevEmpl_ctl00_tbxPREV_EMPL_ADDR_STATE'), data.prevWorkState)) {
      ok++;
    }
    if (isBlank(data.prevWorkZip)) {
      fillCheckbox(id('dtlPrevEmpl_ctl00_cbxPREV_EMPL_ADDR_POSTAL_CD_NA'), true);
    } else if (fillInput(id('dtlPrevEmpl_ctl00_tbxPREV_EMPL_ADDR_POSTAL_CD'), data.prevWorkZip)) {
      ok++;
    }
    // Decisión del usuario (2026-08-11): país del empleador anterior siempre MEX.
    if (fillSelect(id('dtlPrevEmpl_ctl00_DropDownList2'), 'MEX')) ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbEmployerPhone'),             data.prevWorkPhone))     ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbJobTitle'),                  data.prevJobTitle))      ok++;
    if (data.prevSupervisorFirst) {
      if (fillInput(id('dtlPrevEmpl_ctl00_tbSupervisorGivenName'), data.prevSupervisorFirst)) ok++;
    } else {
      fillCheckbox(id('dtlPrevEmpl_ctl00_cbxSupervisorGivenName_NA'), true);
    }
    if (data.prevSupervisorLast) {
      if (fillInput(id('dtlPrevEmpl_ctl00_tbSupervisorSurname'), data.prevSupervisorLast)) ok++;
    } else {
      fillCheckbox(id('dtlPrevEmpl_ctl00_cbxSupervisorSurname_NA'), true);
    }
    if (fillSelect(id('dtlPrevEmpl_ctl00_ddlEmpDateFromDay'),   data.prevWorkStart_day))   ok++;
    if (fillSelect(id('dtlPrevEmpl_ctl00_ddlEmpDateFromMonth'), data.prevWorkStart_month)) ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbxEmpDateFromYear'),  data.prevWorkStart_year))  ok++;
    if (fillSelect(id('dtlPrevEmpl_ctl00_ddlEmpDateToDay'),     data.prevWorkEnd_day))     ok++;
    if (fillSelect(id('dtlPrevEmpl_ctl00_ddlEmpDateToMonth'),   data.prevWorkEnd_month))   ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbxEmpDateToYear'),    data.prevWorkEnd_year))    ok++;
    if (fillInput( id('dtlPrevEmpl_ctl00_tbDescribeDuties'),    data.prevWorkDuties))      ok++;
  } else {
    fillRadio(id('rblPreviouslyEmployed_1'));
  }
  if (data.schoolName) {
    fillRadio(id('rblOtherEduc_0'));
    try { await waitFor(id('dtlPrevEduc_ctl00_tbxSchoolName')); } catch(e) {}
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolName'),          data.schoolName))    ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolAddr1'),          data.schoolStreet))  ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolCity'),           data.schoolCity))    ok++;
    if (isBlank(data.schoolState)) {
      fillCheckbox(id('dtlPrevEduc_ctl00_cbxEDUC_INST_ADDR_STATE_NA'), true);
    } else if (fillInput(id('dtlPrevEduc_ctl00_tbxEDUC_INST_ADDR_STATE'), data.schoolState)) {
      ok++;
    }
    if (isBlank(data.schoolZip)) {
      fillCheckbox(id('dtlPrevEduc_ctl00_cbxEDUC_INST_POSTAL_CD_NA'), true);
    } else if (fillInput(id('dtlPrevEduc_ctl00_tbxEDUC_INST_POSTAL_CD'), data.schoolZip)) {
      ok++;
    }
    // Decisión del usuario (2026-08-11): país de la institución educativa siempre MEX.
    if (fillSelect(id('dtlPrevEduc_ctl00_ddlSchoolCountry'), 'MEX')) ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolCourseOfStudy'),   data.schoolCourse)) ok++;
    if (fillSelect(id('dtlPrevEduc_ctl00_ddlSchoolFromDay'),         data.schoolStart_day))   ok++;
    if (fillSelect(id('dtlPrevEduc_ctl00_ddlSchoolFromMonth'),       data.schoolStart_month)) ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolFromYear'),        data.schoolStart_year))  ok++;
    if (fillSelect(id('dtlPrevEduc_ctl00_ddlSchoolToDay'),           data.schoolEnd_day))     ok++;
    if (fillSelect(id('dtlPrevEduc_ctl00_ddlSchoolToMonth'),         data.schoolEnd_month))   ok++;
    if (fillInput( id('dtlPrevEduc_ctl00_tbxSchoolToYear'),          data.schoolEnd_year))    ok++;
  } else {
    fillRadio(id('rblOtherEduc_1'));
  }
  console.log(`[VP] WorkPrev: ${ok}`); return ok;
}


// ── ADDITIONAL — Idiomas, países visitados, etc. ────────

async function fillAdditional(data) {
  let ok = 0;
  fillRadio(id('rblCLAN_TRIBE_IND_1'));

  // Idiomas
  if (data.language1) {
    if (fillInput(id('dtlLANGUAGES_ctl00_tbxLANGUAGE_NAME'), data.language1)) {
      ok++;
      await clickPostbackLink(document.getElementById(id('dtlLANGUAGES_ctl00_InsertButtonLANGUAGE')));
    }
  }
  if (data.language2) {
    try { await waitForExists(id('dtlLANGUAGES_ctl01_tbxLANGUAGE_NAME')); } catch(e) {
      console.warn('[VP] Additional: no apareció la 2ª fila de idioma a tiempo.', e);
    }
    if (fillInput(id('dtlLANGUAGES_ctl01_tbxLANGUAGE_NAME'), data.language2)) {
      ok++;
      await clickPostbackLink(document.getElementById(id('dtlLANGUAGES_ctl01_InsertButtonLANGUAGE')));
    }
  }
  if (data.language3) {
    try { await waitForExists(id('dtlLANGUAGES_ctl02_tbxLANGUAGE_NAME')); } catch(e) {
      console.warn('[VP] Additional: no apareció la 3ª fila de idioma a tiempo.', e);
    }
    if (fillInput(id('dtlLANGUAGES_ctl02_tbxLANGUAGE_NAME'), data.language3)) ok++;
  }

  // Países visitados
  if (data.country1) {
    fillRadio(id('rblCOUNTRIES_VISITED_IND_0'));
    try { await waitForExists(id('dtlCountriesVisited_ctl00_ddlCOUNTRIES_VISITED')); } catch(e) {}
    if (fillSelect(id('dtlCountriesVisited_ctl00_ddlCOUNTRIES_VISITED'), data.country1)) {
      ok++;
      await clickPostbackLink(document.getElementById(id('dtlCountriesVisited_ctl00_InsertButtonCountriesVisited')));
    }
  } else {
    fillRadio(id('rblCOUNTRIES_VISITED_IND_1'));
  }
  if (data.country2) {
    try { await waitForExists(id('dtlCountriesVisited_ctl01_ddlCOUNTRIES_VISITED')); } catch(e) {
      console.warn('[VP] Additional: no apareció la 2ª fila de país a tiempo.', e);
    }
    if (fillSelect(id('dtlCountriesVisited_ctl01_ddlCOUNTRIES_VISITED'), data.country2)) {
      ok++;
      await clickPostbackLink(document.getElementById(id('dtlCountriesVisited_ctl01_InsertButtonCountriesVisited')));
    }
  }
  if (data.country3) {
    try { await waitForExists(id('dtlCountriesVisited_ctl02_ddlCOUNTRIES_VISITED')); } catch(e) {
      console.warn('[VP] Additional: no apareció la 3ª fila de país a tiempo.', e);
    }
    if (fillSelect(id('dtlCountriesVisited_ctl02_ddlCOUNTRIES_VISITED'), data.country3)) ok++;
  }

  // Preguntas de la página Additional (Work/Education/Additional)
  // Las preguntas de Security and Background tienen su propio botón
  for (const r of [
    'rblORGANIZATION_IND_1','rblSPECIALIZED_SKILLS_IND_1','rblMILITARY_SERVICE_IND_1',
    'rblINSURGENT_ORG_IND_1',
  ]) { fillRadio(id(r)); }

  console.log(`[VP] Additional: ${ok}`); return ok;
}


// ── SECURITY — Security and Background (5 partes) ───────
// Llena con "No" todas las preguntas, da clic real en Next y continúa
// automáticamente en la siguiente parte gracias a un flag en storage.

const SECURITY_PARTS = [
  // Part 1
  ['rblDisease_1','rblDisorder_1','rblDruguser_1'],
  // Part 2
  ['rblArrested_1','rblControlledSubstances_1','rblProstitution_1','rblMoneyLaundering_1',
   'rblHumanTrafficking_1','rblAssistedSevereTrafficking_1','rblHumanTraffickingRelated_1'],
  // Part 3
  ['rblIllegalActivity_1','rblTerroristActivity_1','rblTerroristSupport_1',
   'rblTerroristOrg_1','rblTerroristRel_1','rblGenocide_1','rblTorture_1',
   'rblExViolence_1','rblChildSoldier_1','rblReligiousFreedom_1',
   'rblPopulationControls_1','rblTransplant_1'],
  // Part 4 — confirmado contra el DOM real (2026-08-11): faltaban rblRemovalHearing,
  // rblFailToAttend y rblVisaViolation, solo se marcaban 2 de las 5 preguntas reales.
  ['rblRemovalHearing_1','rblImmigrationFraud_1','rblFailToAttend_1',
   'rblVisaViolation_1','rblDeport_1'],
  // Part 5 — confirmado contra el DOM real (2026-08-11): faltaba rblAttWoReimb,
  // solo se marcaban 3 de las 4 preguntas reales.
  ['rblChildCustody_1','rblVotingViolation_1','rblRenounceExp_1','rblAttWoReimb_1'],
];

// Detecta en qué parte estamos basándose en qué radios existen
function detectSecurityPart() {
  for (let i = 0; i < SECURITY_PARTS.length; i++) {
    if (document.getElementById(id(SECURITY_PARTS[i][0]))) return i;
  }
  return -1;
}

async function fillSecurity(data) {
  const partIdx = detectSecurityPart();
  if (partIdx < 0) {
    console.warn('[VP] No se detectó ninguna parte de Security');
    return 0;
  }

  const radios = SECURITY_PARTS[partIdx];

  // Marcar todos los radios con "No"
  let ok = 0;
  for (const r of radios) {
    if (fillRadio(id(r))) ok++;
  }
  console.log(`[VP] Security Part ${partIdx + 1}: ${ok}/${radios.length} marcados`);

  // Si no es la última parte, guardar flag y hacer clic en Next
  if (partIdx < SECURITY_PARTS.length - 1) {
    await chrome.storage.local.set({ vp_security_continue: true });
    console.log(`[VP] Avanzando a Part ${partIdx + 2}...`);

    // Esperar un momento para que el DOM termine de procesar los cambios
    await new Promise(r => setTimeout(r, 300));

    // Suprimir el diálogo "¿Deseas abandonar el sitio?"
    window.onbeforeunload = null;
    window.addEventListener('beforeunload', e => {
      e.stopImmediatePropagation();
      delete e.returnValue;
    }, { capture: true });

    // Clic real en el botón Next
    const nextBtn = document.getElementById('ctl00_SiteContentPlaceHolder_UpdateButton3');
    if (nextBtn) nextBtn.click();
  } else {
    // Última parte completada, limpiar flag
    await chrome.storage.local.remove('vp_security_continue');
    console.log('[VP] Security completado en todas las partes');
  }

  return ok;
}

// Al cargar el content script, verificar si venimos de un Next de Security
(async () => {
  const result = await chrome.storage.local.get(['vp_security_continue', 'visasproClientData']);
  if (!result.vp_security_continue) return;

  // Esperar a que el DOM esté completamente listo
  await new Promise(r => setTimeout(r, 500));

  // Verificar si estamos en una página de Security
  const partIdx = detectSecurityPart();
  if (partIdx < 0) {
    // No estamos en Security, limpiar flag por si acaso
    await chrome.storage.local.remove('vp_security_continue');
    return;
  }

  console.log(`[VP] Continuando Security automáticamente en Part ${partIdx + 1}`);
  await fillSecurity(result.visasproClientData || {});
})();


// ── Router ───────────────────────────────────────────────

const SECTION_HANDLERS = {
  review: (data) => generateReviewPDF(data),
  pi1:        data => Promise.resolve(fillPI1(data)),
  pi2:        data => Promise.resolve(fillPI2(data)),
  travel:     fillTravel,
  companions: fillCompanions,
  prevTravel: fillPrevTravel,
  address:    data => Promise.resolve(fillAddress(data)),
  passport:   fillPassport,
  contact:    fillContact,
  family:     fillFamily,
  spouse:     fillSpouse,
  work:       fillWork,
  workPrev:   fillWorkPrev,
  additional: fillAdditional,
  security:   fillSecurity,
};


// ── Listener ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'fill') return;
  chrome.storage.local.get('visasproClientData', async result => {
    const data = result.visasproClientData;
    if (!data) { sendResponse({ ok: false, error: 'No hay datos de cliente.' }); return; }
    const handler = SECTION_HANDLERS[message.section];
    if (!handler) { sendResponse({ ok: false, error: `Sección desconocida: ${message.section}` }); return; }
    try {
      const result = await handler(data);
      // Un handler puede devolver solo el conteo (número, formato clásico) o
      // { count, notices } cuando además quiere avisar algo en pantalla (ej. valores
      // por defecto usados) — ver fillTravel.
      const filled  = (result && typeof result === 'object') ? result.count : result;
      const notices = (result && typeof result === 'object') ? result.notices : undefined;
      sendResponse({ ok: true, filled, notices });
    } catch (err) {
      console.error('[VP] Error:', err);
      sendResponse({ ok: false, error: err.message });
    }
  });
  return true;
});

// Auto-continuar sección pendiente después de postback
chrome.storage.local.get(['visasproePendingSection', 'visasproClientData'], async result => {
  if (result.visasproePendingSection && result.visasproClientData) {
    chrome.storage.local.remove('visasproePendingSection');
    const handler = SECTION_HANDLERS[result.visasproePendingSection];
    if (handler) await handler(result.visasproClientData);
  }
});

console.log('[VisasPro] Content script activo en:', window.location.href);


// ── GENERATE REVIEW PDF ──────────────────────────────────

async function generateReviewPDF(data) {
  const clientName = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Cliente';

  // ID de solicitud DS-160 (lo asigna CEAC, visible en el encabezado del master page
  // en todas las pantallas del formulario). Se muestra en la portada del PDF de revisión.
  const appId = document.getElementById('ctl00_lblAppID')?.textContent?.trim() || 'N/D';

  // Secciones a capturar — en orden
  const SECTIONS = [
    { label: 'Personal / Address / Passport', url: 'review_reviewpersonal.aspx?node=ReviewPersonal' },
    { label: 'Travel',                        url: 'review_reviewtravel.aspx?node=ReviewTravel' },
    { label: 'U.S. Contact',                  url: 'review_reviewUSContact.aspx?node=ReviewUSContact' },
    { label: 'Family',                        url: 'review_reviewFamily.aspx?node=ReviewFamily' },
    { label: 'Work / Education',               url: 'review_reviewWorkEducation.aspx?node=ReviewWorkEducation' },
    { label: 'Security and Background',        url: 'review_reviewsecurity.aspx?node=ReviewSecurity' },
  ];

  const base = 'https://ceac.state.gov/GenNIV/General/review/';

  // Detectar qué secciones existen en el menú actual
  const availableLinks = new Set(
    [...document.querySelectorAll('#leftColumnData a')]
      .map(a => a.href.split('/').pop().split('?')[0].toLowerCase())
  );

  const sections = SECTIONS.filter(s => {
    const file = s.url.split('?')[0].toLowerCase();
    return availableLinks.has(file) || availableLinks.size === 0;
  });

  // Obtener los estilos CSS del CEAC para que el PDF se vea igual
  const ceacStyles = [...document.styleSheets]
    .flatMap(ss => {
      try { return [...ss.cssRules].map(r => r.cssText); }
      catch(e) { return []; }
    }).join('\n');

  // Fetch de cada sección
  let allContent = '';
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    try {
      const res = await fetch(base + section.url, { credentials: 'include' });
      if (!res.ok) continue;
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const panel = doc.getElementById('ctl00_SiteContentPlaceHolder_Panel1');
      if (!panel) continue;

      // Limpiar botones de navegación y Print del contenido
      panel.querySelectorAll('input[type="submit"], input[type="image"], .btn, #updatepanel1').forEach(el => el.remove());

      allContent += `
        <div class="vp-section" style="page-break-after: always;">
          <div class="vp-section-header">${i + 1}. ${section.label}</div>
          ${panel.innerHTML}
        </div>
      `;
    } catch(e) {
      console.warn(`[VP] Error al obtener sección ${section.label}:`, e);
    }
  }

  if (!allContent) {
    alert('No se pudo obtener el contenido de revisión. Asegúrate de estar en la sección de Review.');
    return;
  }

  // Construir documento HTML completo
  const printDoc = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Revisión Formulario DS-160 - ${clientName}</title>
  <style>
    ${ceacStyles}

    /* Estilos de portada y estructura */
    body { font-family: Arial, sans-serif; font-size: 11px; margin: 0; padding: 0; }

    .vp-cover {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; min-height: 90vh; text-align: center;
      page-break-after: always;
    }
    .vp-cover h1 { font-size: 22px; color: #1a1a2e; margin-bottom: 8px; }
    .vp-cover h2 { font-size: 18px; color: #e63946; margin-bottom: 24px; }
    .vp-cover p  { font-size: 12px; color: #666; }
    .vp-app-id {
      font-size: 13px; color: #1a1a2e; margin-bottom: 4px;
    }
    .vp-disclaimer {
      max-width: 480px; margin: 24px 20px 0; padding: 12px 16px;
      background: #fffaf0; border: 1px solid #dd6b20; border-radius: 6px;
      font-size: 10px; line-height: 1.5; color: #7b341e; text-align: left;
    }
    .vp-disclaimer strong { display: block; margin-bottom: 4px; font-size: 11px; }


    .vp-section { padding: 20px 30px; }
    .vp-section-header {
      background: #1a1a2e; color: white;
      padding: 8px 14px; font-size: 13px; font-weight: 700;
      margin-bottom: 16px; border-radius: 4px;
    }

    /* Ocultar navegación y botones del CEAC */
    #leftColumnData, .navbar, .nav, [id*="Navigation"],
    input[type="submit"], input[type="image"],
    .HelpPanel, #updatepanel1 { display: none !important; }

    @media print {
      .vp-section { page-break-after: always; }
      .vp-cover   { page-break-after: always; }
    }
  </style>
</head>
<body>

  <!-- Portada -->
  <div class="vp-cover">
    <img src="data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAH6BNoDASIAAhEBAxEB/8QAHQABAAICAwEBAAAAAAAAAAAAAAcIAQkDBQYEAv/EAFcQAAEDAgMEAwkLCAgEBQQDAAABAgMEBQYHEQgSITFBUWETIjdxdYGRobEUGDJCVnSTlLKz0RUWI1JigpLBJDM2Q1NUwsNyc6LhFzRGVfAlRGPxhKPi/8QAHAEBAAIDAQEBAAAAAAAAAAAAAAQFAgMGAQcI/8QAPxEBAAIBAgMDBwoFAwUBAQAAAAECAwQRBRIxIUFRBhMUMlJxsQcVIjM0YYGRodFCU3KSwRYX8CM1VKLhYoL/2gAMAwEAAhEDEQA/ALlgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//Z" style="width:280px;margin-bottom:32px;" alt="VisasPro"/>
    <h1>Revisión Formulario DS-160</h1>
    <h2>${clientName}</h2>
    <p class="vp-app-id">ID de Solicitud DS-160: <strong>${appId}</strong></p>
    <p>${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    <div class="vp-disclaimer">
      <strong>⚠️ Este documento NO es una visa ni un documento oficial.</strong>
      Es una copia de revisión generada por VisasPro únicamente para verificar que los
      datos capturados en el formulario DS-160 del solicitante sean correctos antes de
      su cita consular. No tiene validez migratoria, no debe presentarse ante ninguna
      autoridad como comprobante de visa, de cita o de trámite alguno, y no sustituye
      la confirmación oficial emitida por el Departamento de Estado de los EE. UU.
    </div>
  </div>

  <!-- Secciones -->
  ${allContent}

</body>
</html>`;

  // Abrir en ventana nueva y lanzar impresión → PDF
  const win = window.open('', '_blank');
  win.document.write(printDoc);
  win.document.close();
  win.document.title = `Revisión Formulario DS-160 - ${clientName}`;

  // Esperar a que cargue y lanzar print
  win.onload = () => {
    setTimeout(() => {
      win.print();
    }, 800);
  };
}
