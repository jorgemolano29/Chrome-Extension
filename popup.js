// ════════════════════════════════════════════════════════
//  VISASPRO — POPUP.JS  v2.0
// ════════════════════════════════════════════════════════

// ⚠️  Reemplaza con tu API key de Anthropic
//     Obtén una en: https://console.anthropic.com
const ANTHROPIC_API_KEY = 'sk-ant-XXXXXXXXXXXXXXXXXXXXXXXX';


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


// ── Traducción automática ES → EN via Claude API ─────────
//  Recibe un objeto { pdfKey: textoEnEspañol }
//  Devuelve el mismo objeto con los valores traducidos al inglés
//  Se hace en una sola llamada a la API para minimizar costo

async function translateFields(fieldsToTranslate) {
  if (!fieldsToTranslate || Object.keys(fieldsToTranslate).length === 0) {
    return {};
  }

  const entries = Object.entries(fieldsToTranslate);
  const prompt = [
    'You are translating fields from a Mexican visa application form from Spanish to English.',
    'Translate each value accurately and concisely. Keep proper nouns as-is.',
    'Respond ONLY with a valid JSON object mapping the same keys to their English translations.',
    'Do not include any explanation, markdown, or extra text.',
    '',
    'Fields to translate:',
    JSON.stringify(Object.fromEntries(entries), null, 2),
  ].join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            ANTHROPIC_API_KEY,
        'anthropic-version':    '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`API error ${response.status}: ${err?.error?.message || 'desconocido'}`);
    }

    const data = await response.json();
    const raw  = data.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const translated = JSON.parse(clean);

    console.log('[VisasPro] Traducciones obtenidas:', translated);
    return translated;

  } catch (err) {
    console.error('[VisasPro] Error en traducción:', err);
    // Si falla la traducción, devolvemos los valores originales sin bloquear el flujo
    return Object.fromEntries(entries);
  }
}


// ── Construir objeto cliente aplicando reglas ────────────

function buildClientData(f) {
  const p = k => processField(k, (f[k] || '').trim());
  const r = k => (f[k] || '').trim();

  return {
    // ── Información Personal 1 ──
    firstName:             p('PI1_NOMBRE_SOLICITANTE'),
    lastName:              p('PI1_APELLIDOS_SOLICITANTE'),
    gender:                p('PI1_GENERO'),
    maritalStatus:         p('PI1_ESTADO_CIVIL'),
    dob_day:               r('PI1_DIA_NACIMIENTO_SOLICITANTE'),
    dob_month:             p('PI1_MES_NACIMIENTO_SOLICITANTE'),
    dob_year:              r('PI1_ANO_NACIMIENTO_SOLICITANTE'),
    birthCity:             p('PI1_CIUDAD_NACIMIENTO_SOLICITANTE'),
    birthState:            p('PI1_ESTADO_NACIMIENTO_SOLICITANTE'),
    nationality:           p('PI1_PAIS_REGION_SOLICITANTE'),

    // ── Información Personal 2 ──
    curp:                  p('PI2_CURP'),

    // ── Dirección y contacto ──
    street:                p('DIR_CALLE'),
    city:                  p('DIR_CIUDAD'),
    state:                 p('DIR_ESTADO'),
    zip:                   p('DIR_ZIP'),
    phone:                 p('DIR_CELULAR'),
    email:                 p('DIR_CORREO'),
    socialNetwork:         p('DIR_RRSS'),
    socialHandle:          r('DIR_RRSS_USER'),

    // ── Viaje ──
    travelDate_day:        r('TRA_DIA_VIAJE'),
    travelDate_month:      p('TRA_MES_VIAJE'),
    travelDate_year:       r('TRA_ANO_VIAJE'),
    travelDurationNum:     r('TRA_DURACION_NUMERO'),
    travelDurationUnit:    p('TRA_DURACION_UNIDAD'),
    travelStreet:          p('TRA_HOSPEDAJE_CALLE'),
    travelCity:            p('TRA_HOSPEDAJE_CIUDAD'),
    travelState:           p('TRA_HOSPEDAJE_ESTADO'),
    travelZip:             p('TRA_HOSPEDAJE_ZIP'),
    travelPayer:           p('TRA_QUIEN_PAGA_VIAJE'),
    payerFirstName:        p('TRA_PAGA_VIAJE_NOMBRE'),
    payerLastName:         p('TRA_PAGA_VIAJE_APELLIDO'),
    payerPhone:            p('TRA_PAGA_VIAJE_TELEFONO'),
    payerRelationship:     p('TRA_PAGA_VIAJE_PARENTESCO'),
    payerStreet:           p('TRA_DIRECCION_PAGA_VIAJE_CALLE'),
    payerCity:             p('TRA_DIRECCION_PAGA_VIAJE_CIUDAD'),
    payerState:            p('TRA_DIRECCION_PAGA_VIAJE_ESTADO'),
    payerZip:              p('TRA_DIRECCION_PAGA_VIAJE_ZIP'),

    // ── Acompañantes ──
    companionFirstName:    p('TRA_COM_NOMBRE'),
    companionLastName:     p('TRA_COM_APELLIDO'),
    companionRelationship: p('TRA_COM_PARENTESCO'),

    // ── Viajes previos ──
    prevTravel_day:        r('PUST_DIA'),
    prevTravel_month:      p('PUST_MES'),
    prevTravel_year:       r('PUST_ANO'),
    prevTravelDurationNum: r('PUST_DURACION_NUMERO'),
    prevTravelDurationUnit:p('PUST_DURACION_UNIDAD'),
    visaIssue_day:         r('PUST_VISA_PREVIA_E_DIA'),
    visaIssue_month:       p('PUST_VISA_PREVIA_E_MES'),
    visaIssue_year:        r('PUST_VISA_PREVIA_E_ANO'),
    visaExpiry_day:        r('PUST_VISA_PREVIA_V_DIA'),
    visaExpiry_month:      p('PUST_VISA_PREVIA_V_MES'),
    visaExpiry_year:       r('PUST_VISA_PREVIA_V_ANO'),
    visaNumber:            p('PUST_VISA_PREVIA_NUMERO'),
    visaLostYear:          r('PUST_ANO_EXTRAVIO'),
    visaLostExplanation:   p('PUST_EXP_EXTRAVIO'),   // será sobreescrito por traducción
    visaRefusedExplanation:p('PUST_EXP_RECHAZO'),    // será sobreescrito por traducción

    // ── Pasaporte ──
    passportNumber:        p('PAS_NUMBER'),
    passportCity:          p('PAS_EMISION_CIUDAD'),
    passportState:         p('PAS_EMISION_ESTADO'),
    passportCountry:       p('PAS_EMISION_PAIS'),
    passportIssue_day:     r('PAS_EXP_DIA'),
    passportIssue_month:   p('PAS_EXP_MES'),
    passportIssue_year:    r('PAS_EXP_ANO'),
    passportExpiry_day:    r('PAS_VEN_DIA'),
    passportExpiry_month:  p('PAS_VEN_MES'),
    passportExpiry_year:   r('PAS_VEN_ANO'),
    passportLostNumber:    p('PAS_EXTRAVIO_NUM'),
    passportLostExplanation: p('PAS_EXTRAVIO_EXP'),  // será sobreescrito por traducción

    // ── Contacto en EUA ──
    usContactFirstName:    p('CONTUSA_NOMBRE'),
    usContactLastName:     p('CONTUSA_APELLIDO'),
    usContactHotel:        p('CONTUSA_HOTEL'),
    usContactRelationship: p('CONTAUSA_PARENTESCO'),
    usContactStreet:       p('CONTAUSA_CALLE'),
    usContactCity:         p('CONTAUSA_CIUDAD'),
    usContactState:        p('CONTAUSA_ESTADO'),
    usContactZip:          p('CONTAUSA_ZIP'),
    usContactPhone:        p('CONTAUSA_TEL'),

    // ── Familia ──
    fatherFirstName:       p('FAM_NOMBRE_PADRE'),
    fatherLastName:        p('FAM_APELLIDO_PADRE'),
    fatherDob_day:         r('FAM_DIA_PADRE'),
    fatherDob_month:       p('FAM_MES_PADRE'),
    fatherDob_year:        r('FAM_ANO_PADRE'),
    motherFirstName:       p('FAM_NOMBRE_MADRE'),
    motherLastName:        p('FAM_APELLIDO_MADRE'),
    motherDob_day:         r('FAM_DIA_MADRE'),
    motherDob_month:       p('FAM_MES_MADRE'),
    motherDob_year:        r('FAM_ANO_MADRE'),
    usRelativeFirstName:   p('FAM_DIRECTA_NOMBRE'),
    usRelativeLastName:    p('FAM_DIRECTA_APELLIDO'),
    usRelativeRelationship:p('FAM_DIRECTA_PARENTESCO'),
    usRelativeStatus:      p('FAM_DIRECTA_ESTATUS'),
    hasOtherUSRelative:    r('FAM_OTRO_FAMILIAR'),

    // ── Pareja ──
    spouseFirstName:       p('PAREJA_NOMBRE'),
    spouseLastName:        p('PAREJA_APELLIDO'),
    spouseNationality:     p('PAREJA_NACIONALIDAD'),
    spouseDob_day:         r('PAREJA_DIA'),
    spouseDob_month:       p('PAREJA_MES'),
    spouseDob_year:        r('PAREJA_ANO'),
    spouseBirthCity:       p('PAREJA_CIUDAD'),
    spouseBirthCountry:    p('PAREJA_PAIS'),

    // ── Trabajo actual ──
    occupation:            p('WET_PRESENT_OCUPACION'),
    employer:              p('WET_PRESENT_NOBRE_LUGAR'),
    workStreet:            p('WET_PRESENT_CALLE'),
    workCity:              p('WET_PRESENT_CIUDAD'),
    workState:             p('WET_PRESENT_ESTADO'),
    workZip:               p('WET_PRESENT_ZIP'),
    workPhone:             p('WET_PRESENT_TEL'),
    workStart_day:         r('WET_PRESENT_INGRESO_DIA'),
    workStart_month:       p('WET_PRESENT_INGRESO_MES'),
    workStart_year:        r('WET_PRESENT_INGRESO_ANO'),
    workSalary:            r('WET_PRESENT_INGRESO_MXN'),
    workDuties:            p('WET_PRESENT_ACTIVIDADES'),  // será sobreescrito por traducción

    // ── Trabajo anterior ──
    prevEmployer:          p('WET_PREV_NOMBRE'),
    prevWorkStreet:        p('WET_PREV_CALLE'),
    prevWorkCity:          p('WET_PREV_CIUDAD'),
    prevWorkState:         p('WET_PREV_ESTADO'),
    prevWorkZip:           p('WET_PREV_ZIP'),
    prevWorkCountry:       p('WET_PREV_PAIS'),
    prevWorkPhone:         p('WET_PREV_TEL'),
    prevJobTitle:          p('WET_PREV_PUESTO'),          // será sobreescrito por traducción
    prevSupervisorFirst:   p('WET_PREV_JEFE_NOMBRE'),
    prevSupervisorLast:    p('WET_PREV_JEFE_APELLIDO'),
    prevWorkStart_day:     r('WET_PREV_ING_DIA'),
    prevWorkStart_month:   p('WET_PREV_ING_MES'),
    prevWorkStart_year:    r('WET_PREV_ING_ANO'),
    prevWorkEnd_day:       r('WET_PREV_SALIDA_DIA'),
    prevWorkEnd_month:     p('WET_PREV_SALIDA_MES'),
    prevWorkEnd_year:      r('WET_PREV_SALIDA_ANO'),
    prevWorkDuties:        p('WET_PREV_ACTIVIDADES'),     // será sobreescrito por traducción

    // ── Estudios ──
    schoolName:            p('EST_NOMBRE_ESCUELA'),
    schoolStreet:          p('EST_CALLE'),
    schoolCity:            p('EST_CIUDAD'),
    schoolState:           p('EST_ESTADO'),
    schoolZip:             p('EST_ZIP'),
    schoolCountry:         p('EST_PAIS'),
    schoolCourse:          p('EST_CURSO'),                // será sobreescrito por traducción
    schoolStart_day:       r('EST_ING_DIA'),
    schoolStart_month:     p('EST_ING_MES'),
    schoolStart_year:      r('EST_ING_ANO'),
    schoolEnd_day:         r('EST_SALIDA_DIA'),
    schoolEnd_month:       p('EST_SALIDA_MES'),
    schoolEnd_year:        r('EST_SALIDA_ANO'),

    // ── Adicional ──
    language1:             p('ADD_IDIOMA_1'),
    language2:             p('ADD_IDIOMA_2'),
    language3:             p('ADD_IDIOMA_3'),
    country1:              p('ADD_PAIS_1'),
    country2:              p('ADD_PAIS_2'),
    country3:              p('ADD_PAIS_3'),
  };
}


// ── Mapeo PDF key → propiedad del objeto data ─────────────
//  Solo los campos con translate:true en FIELD_RULES

const TRANSLATE_KEY_MAP = {
  'PUST_EXP_EXTRAVIO':    'visaLostExplanation',
  'PUST_EXP_RECHAZO':     'visaRefusedExplanation',
  'PAS_EXTRAVIO_EXP':     'passportLostExplanation',
  'WET_PRESENT_ACTIVIDADES': 'workDuties',
  'WET_PREV_PUESTO':      'prevJobTitle',
  'WET_PREV_ACTIVIDADES': 'prevWorkDuties',
  'EST_CURSO':            'schoolCourse',
};


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

document.getElementById('btn-pi1').addEventListener('click',         () => fillSection('pi1'));
document.getElementById('btn-pi2').addEventListener('click',         () => fillSection('pi2'));
document.getElementById('btn-travel').addEventListener('click',      () => fillSection('travel'));
document.getElementById('btn-companions').addEventListener('click',  () => fillSection('companions'));
document.getElementById('btn-prevtravel').addEventListener('click',  () => fillSection('prevTravel'));
document.getElementById('btn-address').addEventListener('click',     () => fillSection('address'));
document.getElementById('btn-passport').addEventListener('click',    () => fillSection('passport'));
document.getElementById('btn-contact').addEventListener('click',     () => fillSection('contact'));
document.getElementById('btn-family').addEventListener('click',      () => fillSection('family'));
document.getElementById('btn-work').addEventListener('click',        () => fillSection('work'));
document.getElementById('btn-security').addEventListener('click',    () => fillSection('security'));

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
    // 1 — Leer y parsear PDF
    const buffer = await file.arrayBuffer();
    setProgress(30, 'Extrayendo campos...');
    const rawFields = parsePDFFields(buffer);
    const fieldCount = Object.keys(rawFields).length;

    if (fieldCount < 5) {
      throw new Error(`Solo se encontraron ${fieldCount} campos. ¿Es el formulario VisasPro correcto?`);
    }

    // 2 — Aplicar reglas de limpieza y equivalencias
    setProgress(55, 'Aplicando reglas...');
    const data = buildClientData(rawFields);

    // 3 — Traducir campos ES→EN via Claude API
    const toTranslate = getTranslatableFields(rawFields);
    const hasTranslatable = Object.keys(toTranslate).length > 0;

    if (hasTranslatable) {
      setProgress(75, 'Traduciendo campos...');
      const translations = await translateFields(toTranslate);

      // Sobreescribir en data los campos traducidos
      for (const [pdfKey, translated] of Object.entries(translations)) {
        const dataKey = TRANSLATE_KEY_MAP[pdfKey];
        if (dataKey && translated) {
          data[dataKey] = translated;
        }
      }
    }

    // 4 — Guardar y mostrar
    setProgress(100, '¡Listo!');
    chrome.storage.local.set({ visasproClientData: data }, () => {
      console.log('[VisasPro] Datos guardados:', data);
    });

    showProgress(false);
    renderClientCard(data);

    const translatedCount = hasTranslatable ? Object.keys(toTranslate).length : 0;
    const msg = translatedCount > 0
      ? `✅ PDF cargado. ${fieldCount} campos extraídos, ${translatedCount} traducidos.`
      : `✅ PDF cargado. ${fieldCount} campos extraídos.`;
    showAlert(msg, 'success');

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
    <div class="data-item">
      <div class="lbl">Pasaporte</div>
      <div class="val">${data.passportNumber || '—'}</div>
    </div>
    <div class="data-item">
      <div class="lbl">Ocupación</div>
      <div class="val">${data.occupation || '—'}</div>
    </div>
  `;

  document.getElementById('step1').style.display        = 'none';
  document.getElementById('client-card').style.display  = 'block';
}


// ── Limpiar ──────────────────────────────────────────────

function clearData() {
  chrome.storage.local.remove('visasproClientData');
  document.getElementById('client-card').style.display = 'none';
  document.getElementById('step1').style.display       = 'block';
  document.getElementById('pdf-input').value           = '';
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
  el.textContent = msg;
  el.className   = `alert ${type}`;
  el.style.display = 'block';
}
function hideAlert() {
  document.getElementById('alert').style.display = 'none';
}


// ── Restaurar datos previos al abrir el popup ────────────

chrome.storage.local.get('visasproClientData', result => {
  if (result.visasproClientData) {
    renderClientCard(result.visasproClientData);
  }
});
