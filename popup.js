// ════════════════════════════════════════════════════════
//  VISASPRO — POPUP.JS
// ════════════════════════════════════════════════════════


// ── Parser PDF ──────────────────────────────────────────

function parsePDFFields(buffer) {
  const bytes = new Uint8Array(buffer);
  let pdf = '';
  for (let i = 0; i < bytes.length; i++) {
    pdf += String.fromCharCode(bytes[i]);
  }

  const objIndex = {};
  const objRe = /(\d+)\s+0\s+obj\s*([\s\S]*?)\s*endobj/g;
  let m;
  while ((m = objRe.exec(pdf)) !== null) {
    objIndex[m[1]] = m[2];
  }

  function decodePDFString(s) {
    return s
      .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseDict(str) {
    const result = {};

    const tMatch = str.match(/\/T\s*\(([^)]*)\)/);
    if (tMatch) result.T = decodePDFString(tMatch[1]);

    // FIX: regex que maneja paréntesis escapados dentro del valor
    const vStrMatch = str.match(/\/V\s*\(((?:[^)(\\]|\\.|\([^)]*\))*)\)/);
    const vNameMatch = str.match(/\/V\s*\/([^\s\/\[<()\]]+)/);
    if (vStrMatch) result.V = decodePDFString(vStrMatch[1]);
    else if (vNameMatch && vNameMatch[1] !== 'Off') result.V = vNameMatch[1];

    const parentMatch = str.match(/\/Parent\s+(\d+)\s+0\s+R/);
    if (parentMatch) result.parentId = parentMatch[1];

    const subtypeMatch = str.match(/\/Subtype\s*\/(\w+)/);
    if (subtypeMatch) result.Subtype = subtypeMatch[1];

    return result;
  }

  const fields = {};

  for (const [objId, body] of Object.entries(objIndex)) {
    if (!body.includes('/Widget')) continue;

    const obj = parseDict(body);

    if (obj.T && obj.V && obj.V !== 'no aplica') {
      fields[obj.T] = obj.V;
      continue;
    }

    if (!obj.T && obj.parentId && objIndex[obj.parentId]) {
      const parent = parseDict(objIndex[obj.parentId]);
      if (parent.T && parent.V && parent.V !== 'no aplica') {
        fields[parent.T] = parent.V;
      }
    }
  }

  console.log('[VisasPro] Campos extraídos del PDF:', fields);
  return fields;
}


// ── Construir objeto cliente aplicando reglas ────────────
//  Usa processField() de mappings.js para limpiar o traducir
//  cada campo según su regla definida en FIELD_RULES

function buildClientData(f) {
  // Shorthand: obtiene valor crudo y aplica su regla
  const p = k => processField(k, (f[k] || '').trim());
  // Shorthand: solo valor crudo sin procesar (ej. días, años)
  const r = k => (f[k] || '').trim();

  return {
    // ── Información personal ──
    firstName:        p('PI1_NOMBRE_SOLICITANTE'),
    lastName:         p('PI1_APELLIDOS_SOLICITANTE'),
    gender:           p('PI1_GENERO'),
    maritalStatus:    p('PI1_ESTADO_CIVIL'),
    dob_day:          r('PI1_DIA_NACIMIENTO_SOLICITANTE'),
    dob_month:        p('PI1_MES_NACIMIENTO_SOLICITANTE'),
    dob_year:         r('PI1_ANO_NACIMIENTO_SOLICITANTE'),
    birthCity:        p('PI1_CIUDAD_NACIMIENTO_SOLICITANTE'),
    birthState:       p('PI1_ESTADO_NACIMIENTO_SOLICITANTE'),
    nationality:      p('PI1_PAIS_REGION_SOLICITANTE'),
    curp:             p('PI2_CURP'),

    // ── Viaje ──
    travelDate_day:   r('TRA_DIA_VIAJE'),
    travelDate_month: p('TRA_MES_VIAJE'),
    travelDate_year:  r('TRA_ANO_VIAJE'),
    travelDurationNum:  r('TRA_DURACION_NUMERO'),
    travelDurationUnit: p('TRA_DURACION_UNIDAD'),
    travelStreet:       p('TRA_HOSPEDAJE_CALLE'),
    travelCity:         p('TRA_HOSPEDAJE_CIUDAD'),
    travelState:        p('TRA_HOSPEDAJE_ESTADO'),
    travelZip:          r('TRA_HOSPEDAJE_ZIP'),
    travelPayer:        p('TRA_QUIEN_PAGA_VIAJE'),
    payerFirstName:     p('TRA_PAGA_VIAJE_NOMBRE'),
    payerLastName:      p('TRA_PAGA_VIAJE_APELLIDO'),
    payerPhone:         p('TRA_PAGA_VIAJE_TELEFONO'),
    payerRelationship:  p('TRA_PAGA_VIAJE_PARENTESCO'),
    payerStreet:        p('TRA_DIRECCION_PAGA_VIAJE_CALLE'),
    payerCity:          p('TRA_DIRECCION_PAGA_VIAJE_CIUDAD'),
    payerState:         p('TRA_DIRECCION_PAGA_VIAJE_ESTADO'),
    payerZip:           r('TRA_DIRECCION_PAGA_VIAJE_ZIP'),
    companionFirstName:    p('TRA_COM_NOMBRE'),
    companionLastName:     p('TRA_COM_APELLIDO'),
    companionRelationship: r('TRA_COM_PARENTESCO'),

    // ── Viajes previos ──
    prevTravel_day:   r('PUST_DIA'),
    prevTravel_month: p('PUST_MES'),
    prevTravel_year:  r('PUST_ANO'),
    prevTravelDuration:`${r('PUST_DURACION_NUMERO')} ${r('PUST_DURACION_UNIDAD')}`,
    visaNumber:       r('PUST_VISA_PREVIA_NUMERO'),
    visaIssue_day:    r('PUST_VISA_PREVIA_E_DIA'),
    visaIssue_month:  p('PUST_VISA_PREVIA_E_MES'),
    visaIssue_year:   r('PUST_VISA_PREVIA_E_ANO'),
    visaExpiry_day:   r('PUST_VISA_PREVIA_V_DIA'),
    visaExpiry_month: p('PUST_VISA_PREVIA_V_MES'),
    visaExpiry_year:  r('PUST_VISA_PREVIA_V_ANO'),

    // ── Dirección y contacto ──
    street:           p('DIR_CALLE'),
    city:             p('DIR_CIUDAD'),
    state:            p('DIR_ESTADO'),
    country:          r('DIR_PAIS'),
    zip:              r('DIR_ZIP'),
    phone:            p('DIR_CELULAR'),
    email:            p('DIR_CORREO'),
    socialNetwork:    r('DIR_RRSS'),
    socialHandle:     r('DIR_RRSS_USER'),

    // ── Pasaporte ──
    passportNumber:   p('PAS_NUMBER'),
    passportCity:     p('PAS_EMISION_CIUDAD'),
    passportState:    p('PAS_EMISION_ESTADO'),
    passportCountry:  p('PAS_EMISION_PAIS'),
    passportIssue_day:  r('PAS_EXP_DIA'),
    passportIssue_month:p('PAS_EXP_MES'),
    passportIssue_year: r('PAS_EXP_ANO'),
    passportExpiry_day:  r('PAS_VEN_DIA'),
    passportExpiry_month:p('PAS_VEN_MES'),
    passportExpiry_year: r('PAS_VEN_ANO'),

    // ── Contacto en EUA ──
    usContactFirstName:    p('CONTUSA_NOMBRE'),
    usContactLastName:     p('CONTUSA_APELLIDO'),
    usContactRelationship: r('CONTAUSA_PARENTESCO'),
    usContactStreet:       p('CONTAUSA_CALLE'),
    usContactCity:         p('CONTAUSA_CIUDAD'),
    usContactState:        p('CONTAUSA_ESTADO'),
    usContactZip:          r('CONTAUSA_ZIP'),
    usContactPhone:        p('CONTAUSA_TEL'),

    // ── Familia ──
    fatherFirstName:  p('FAM_NOMBRE_PADRE'),
    fatherLastName:   p('FAM_APELLIDO_PADRE'),
    fatherDob_day:    r('FAM_DIA_PADRE'),
    fatherDob_month:  p('FAM_MES_PADRE'),
    fatherDob_year:   r('FAM_ANO_PADRE'),
    motherFirstName:  p('FAM_NOMBRE_MADRE'),
    motherLastName:   p('FAM_APELLIDO_MADRE'),
    motherDob_day:    r('FAM_DIA_MADRE'),
    motherDob_month:  p('FAM_MES_MADRE'),
    motherDob_year:   r('FAM_ANO_MADRE'),
    familyInUSA:      r('FAM_OTRO_FAMILIAR'),

    // ── Trabajo / educación ──
    occupation:       r('WET_PRESENT_OCUPACION'),
    employer:         p('WET_PRESENT_NOBRE_LUGAR'),
    workStreet:       p('WET_PRESENT_CALLE'),
    workCity:         p('WET_PRESENT_CIUDAD'),
    workState:        p('WET_PRESENT_ESTADO'),
    workZip:          r('WET_PRESENT_ZIP'),
    workPhone:        p('WET_PRESENT_TEL'),
    workStart_day:    r('WET_PRESENT_INGRESO_DIA'),
    workStart_month:  p('WET_PRESENT_INGRESO_MES'),
    workStart_year:   r('WET_PRESENT_INGRESO_ANO'),

    // ── Países visitados ──
    countriesVisited: r('ADD_PAIS_1'),
  };
}


// ── Flujo principal ──────────────────────────────────────

document.getElementById('pdf-input').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf') {
    showAlert('Solo se aceptan archivos PDF.', 'error');
    return;
  }
  processPDF(file);
});

document.getElementById('btn-clear').addEventListener('click', clearData);

document.getElementById('btn-pi1').addEventListener('click',      () => fillSection('pi1'));
document.getElementById('btn-pi2').addEventListener('click',      () => fillSection('pi2'));
document.getElementById('btn-travel').addEventListener('click',   () => fillSection('travel'));
document.getElementById('btn-passport').addEventListener('click', () => fillSection('passport'));
document.getElementById('btn-contact').addEventListener('click',  () => fillSection('contact'));
document.getElementById('btn-family').addEventListener('click',   () => fillSection('family'));
document.getElementById('btn-work').addEventListener('click',     () => fillSection('work'));

async function fillSection(section) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: 'fill', section }, (response) => {
    if (chrome.runtime.lastError) {
      showAlert('❌ Recarga la página del DS-160 y vuelve a intentar.', 'error');
      return;
    }
    if (response && response.ok) {
      showAlert(`✅ ${section.toUpperCase()} — ${response.filled} campos llenados.`, 'success');
    } else {
      showAlert(`❌ Error: ${response?.error || 'desconocido'}`, 'error');
    }
  });
}

async function processPDF(file) {
  showProgress(true);
  setProgress(10, 'Leyendo archivo...');
  hideAlert();

  try {
    const buffer = await file.arrayBuffer();
    setProgress(50, 'Extrayendo campos...');

    const rawFields = parsePDFFields(buffer);
    const fieldCount = Object.keys(rawFields).length;

    if (fieldCount < 5) {
      throw new Error(`Solo se encontraron ${fieldCount} campos. ¿Es el formulario VisasPro correcto?`);
    }

    setProgress(85, 'Aplicando reglas...');
    const data = buildClientData(rawFields);

    setProgress(100, '¡Listo!');

    chrome.storage.local.set({ visasproClientData: data }, () => {
      console.log('[VisasPro] Datos guardados:', data);
    });

    showProgress(false);
    renderClientCard(data);
    showAlert(`✅ PDF cargado. ${fieldCount} campos extraídos.`, 'success');

  } catch (err) {
    console.error('[VisasPro] Error:', err);
    showProgress(false);
    showAlert('❌ ' + err.message, 'error');
  }
}


// ── Renderizar tarjeta ───────────────────────────────────

function renderClientCard(data) {
  const fullName = `${data.firstName} ${data.lastName}`.trim();
  const initials = ((data.firstName||'')[0]||'') + ((data.lastName||'')[0]||'');

  document.getElementById('avatar').textContent      = initials.toUpperCase() || '?';
  document.getElementById('client-name').textContent = fullName || '—';
  document.getElementById('client-sub').textContent  = data.curp || '—';

  document.getElementById('data-grid').innerHTML = `
    <div class="data-item">
      <div class="lbl">Fecha de Nacimiento</div>
      <div class="val">${data.dob_day}/${data.dob_month}/${data.dob_year}</div>
    </div>
    <div class="data-item">
      <div class="lbl">Género</div>
      <div class="val">${data.gender || '—'}</div>
    </div>
    <div class="data-item">
      <div class="lbl">Estado Civil</div>
      <div class="val">${data.maritalStatus || '—'}</div>
    </div>
    <div class="data-item">
      <div class="lbl">Ciudad de Nacimiento</div>
      <div class="val">${data.birthCity || '—'}</div>
    </div>
  `;

  document.getElementById('step1').style.display   = 'none';
  document.getElementById('client-card').style.display = 'block';
}


// ── Limpiar ──────────────────────────────────────────────

function clearData() {
  chrome.storage.local.remove('visasproClientData');
  document.getElementById('client-card').style.display = 'none';
  document.getElementById('step1').style.display       = 'block';
  document.getElementById('pdf-input').value = '';
  hideAlert();
}


// ── UI helpers ───────────────────────────────────────────

function showProgress(show) {
  document.getElementById('progress-wrap').style.display = show ? 'block' : 'none';
}
function setProgress(pct, msg) {
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent  = pct + '%';
  if (msg) document.getElementById('progress-msg').textContent = msg;
}
function showAlert(msg, type) {
  const el = document.getElementById('alert');
  el.textContent = msg; el.className = `alert ${type}`; el.style.display = 'block';
}
function hideAlert() {
  document.getElementById('alert').style.display = 'none';
}


// ── Restaurar datos previos ──────────────────────────────

chrome.storage.local.get('visasproClientData', result => {
  if (result.visasproClientData) {
    renderClientCard(result.visasproClientData);
  }
});
