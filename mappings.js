// ════════════════════════════════════════════════════════
//  VISASPRO — MAPPINGS.JS
// ════════════════════════════════════════════════════════

const CLEAN = {
  name: (val) => (val || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^A-Z0-9 ]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase(),

  address: (val) => CLEAN.name(val),

  phone: (val) => (val || '')
    .trim()
    .replace(/[^\d]/g, '')
    .slice(0, 10),

  email: (val) => (val || '')
    .trim()
    .toLowerCase(),

  number: (val) => (val || '')
    .trim()
    .replace(/\D/g, ''),
};

const EQUIV = {

  gender: {
    'Masculino': 'M',
    'Femenino':  'F',
  },

  maritalStatus: {
    'Casado(a)':                            'M',
    'Union libre':                          'C',
    'Union civil/Vida conyugal':            'P',
    'Soltero(a)':                           'S',
    'Viudo(a)':                             'W',
    'Divorciado(a)':                        'D',
    'Legalmente separado(a) de su conyuge': 'L',
    'Otro':                                 'O',
  },

  month: {
    'Enero':      'Jan',
    'Febrero':    'Feb',
    'Marzo':      'Mar',
    'Abril':      'Apr',
    'Mayo':       'May',
    'Junio':      'Jun',
    'Julio':      'Jul',
    'Agosto':     'Aug',
    'Septiembre': 'Sep',
    'Octubre':    'Oct',
    'Noviembre':  'Nov',
    'Diciembre':  'Dec',
  },

  // Estados de México (país/región de nacimiento)
  country: {
    'Aguascalientes':       'AGS',
    'Baja California':      'BC',
    'Baja California Sur':  'BCSR',
    'Campeche':             'CAMP',
    'Chiapas':              'CHIS',
    'Chihuahua':            'CHIH',
    'Coahuila':             'COAH',
    'Colima':               'COLI',
    'Distrito Federal':     'DF',
    'Ciudad de Mexico':     'DF',
    'Durango':              'DGO',
    'Guanajuato':           'GTO',
    'Guerrero':             'GRO',
    'Hidalgo':              'HGO',
    'Jalisco':              'JAL',
    'Michoacan':            'MCH',
    'Morelos':              'MOR',
    'Nayarit':              'NAY',
    'Nuevo Leon':           'NL',
    'Mexico - Nuevo Leon':  'NL',
    'Oaxaca':               'OAX',
    'Puebla':               'PUE',
    'Queretaro':            'QRO',
    'Quintana Roo':         'QROO',
    'San Luis Potosi':      'SLP',
    'Sinaloa':              'SIN',
    'Sonora':               'SON',
    'Estado de Mexico':     'MXCO',
    'Tabasco':              'TAB',
    'Tamaulipas':           'TAMP',
    'Tlaxcala':             'TLAX',
    'Veracruz':             'VER',
    'Yucatan':              'YUC',
    'Zacatecas':            'ZAC',
  },

  // Duración del viaje — unidad
  travelDurationUnit: {
    'Día(s)':     'D',
    'Dia(s)':     'D',
    'Días':       'D',
    'Dias':       'D',
    'Semana(s)':  'W',
    'Semanas':    'W',
    'Mes(es)':    'M',
    'Meses':      'M',
    'Año(s)':     'Y',
    'Ano(s)':     'Y',
    'Años':       'Y',
    'Anos':       'Y',
  },

  // ¿Quién paga el viaje?
  travelPayer: {
    'Yo mismo':       'S',
    'El solicitante': 'S',
    'Hijo(a)':        'O',
    'Padre o Madre':  'O',
    'Conyuge':        'O',
    'Otro pariente':  'O',
    'Amigo(a)':       'O',
    'Otros':          'O',
    'Empleador':      'P',
    'Empresa':        'C',
  },

  // Parentesco del pagador
  payerRelationship: {
    'Hijo(a)':       'O',
    'Padre o Madre': 'P',
    'Conyuge':       'S',
    'Otro pariente': 'O',
    'Amigo(a)':      'O',
    'Empleador':     'E',
    'Otros':         'O',
  },

  // Estados de EUA (hospedaje)
  usState: {
    'Alabama':        'AL',
    'Alaska':         'AK',
    'Arizona':        'AZ',
    'Arkansas':       'AR',
    'California':     'CA',
    'Colorado':       'CO',
    'Connecticut':    'CT',
    'Delaware':       'DE',
    'Florida':        'FL',
    'Georgia':        'GA',
    'Hawaii':         'HI',
    'Idaho':          'ID',
    'Illinois':       'IL',
    'Indiana':        'IN',
    'Iowa':           'IA',
    'Kansas':         'KS',
    'Kentucky':       'KY',
    'Louisiana':      'LA',
    'Maine':          'ME',
    'Maryland':       'MD',
    'Massachusetts':  'MA',
    'Michigan':       'MI',
    'Minnesota':      'MN',
    'Mississippi':    'MS',
    'Missouri':       'MO',
    'Montana':        'MT',
    'Nebraska':       'NE',
    'Nevada':         'NV',
    'New Hampshire':  'NH',
    'New Jersey':     'NJ',
    'New Mexico':     'NM',
    'New York':       'NY',
    'North Carolina': 'NC',
    'North Dakota':   'ND',
    'Ohio':           'OH',
    'Oklahoma':       'OK',
    'Oregon':         'OR',
    'Pennsylvania':   'PA',
    'Rhode Island':   'RI',
    'South Carolina': 'SC',
    'South Dakota':   'SD',
    'Tennessee':      'TN',
    'Texas':          'TX',
    'Utah':           'UT',
    'Vermont':        'VT',
    'Virginia':       'VA',
    'Washington':     'WA',
    'West Virginia':  'WV',
    'Wisconsin':      'WI',
    'Wyoming':        'WY',
  },

};

const FIELD_RULES = {

  // ── PI1 ──
  'PI1_NOMBRE_SOLICITANTE':              { clean: 'name'             },
  'PI1_APELLIDOS_SOLICITANTE':           { clean: 'name'             },
  'PI1_GENERO':                          { equiv: 'gender'           },
  'PI1_ESTADO_CIVIL':                    { equiv: 'maritalStatus'    },
  'PI1_MES_NACIMIENTO_SOLICITANTE':      { equiv: 'month'            },
  'PI1_CIUDAD_NACIMIENTO_SOLICITANTE':   { clean: 'name'             },
  'PI1_ESTADO_NACIMIENTO_SOLICITANTE':   { clean: 'name'             },
  'PI1_PAIS_REGION_SOLICITANTE':         { equiv: 'country'          },

  // ── PI2 ──
  'PI2_CURP':                            { clean: 'name'             },

  // ── Dirección personal ──
  'DIR_CALLE':                           { clean: 'address'          },
  'DIR_CIUDAD':                          { clean: 'name'             },
  'DIR_ESTADO':                          { clean: 'name'             },
  'DIR_CELULAR':                         { clean: 'phone'            },
  'DIR_CORREO':                          { clean: 'email'            },

  // ── Viaje ──
  'TRA_MES_VIAJE':                       { equiv: 'month'            },
  'TRA_DURACION_UNIDAD':                 { equiv: 'travelDurationUnit'},
  'TRA_HOSPEDAJE_CALLE':                 { clean: 'address'          },
  'TRA_HOSPEDAJE_CIUDAD':                { clean: 'name'             },
  'TRA_HOSPEDAJE_ESTADO':                { equiv: 'usState'          },
  'TRA_QUIEN_PAGA_VIAJE':                { equiv: 'travelPayer'      },
  'TRA_PAGA_VIAJE_NOMBRE':               { clean: 'name'             },
  'TRA_PAGA_VIAJE_APELLIDO':             { clean: 'name'             },
  'TRA_PAGA_VIAJE_TELEFONO':             { clean: 'phone'            },
  'TRA_PAGA_VIAJE_PARENTESCO':           { equiv: 'payerRelationship'},
  'TRA_DIRECCION_PAGA_VIAJE_CALLE':      { clean: 'address'          },
  'TRA_DIRECCION_PAGA_VIAJE_CIUDAD':     { clean: 'name'             },
  'TRA_DIRECCION_PAGA_VIAJE_ESTADO':     { clean: 'name'             },
  'TRA_COM_NOMBRE':                      { clean: 'name'             },
  'TRA_COM_APELLIDO':                    { clean: 'name'             },

  // ── Viajes previos ──
  'PUST_MES':                            { equiv: 'month'            },
  'PUST_VISA_PREVIA_E_MES':              { equiv: 'month'            },
  'PUST_VISA_PREVIA_V_MES':              { equiv: 'month'            },

  // ── Pasaporte ──
  'PAS_NUMBER':                          { clean: 'name'             },
  'PAS_EMISION_CIUDAD':                  { clean: 'name'             },
  'PAS_EMISION_ESTADO':                  { clean: 'name'             },
  'PAS_EMISION_PAIS':                    { equiv: 'country'          },
  'PAS_EXP_MES':                         { equiv: 'month'            },
  'PAS_VEN_MES':                         { equiv: 'month'            },

  // ── Contacto EUA ──
  'CONTUSA_NOMBRE':                      { clean: 'name'             },
  'CONTUSA_APELLIDO':                    { clean: 'name'             },
  'CONTAUSA_CALLE':                      { clean: 'address'          },
  'CONTAUSA_CIUDAD':                     { clean: 'name'             },
  'CONTAUSA_ESTADO':                     { clean: 'name'             },
  'CONTAUSA_TEL':                        { clean: 'phone'            },

  // ── Familia ──
  'FAM_NOMBRE_PADRE':                    { clean: 'name'             },
  'FAM_APELLIDO_PADRE':                  { clean: 'name'             },
  'FAM_MES_PADRE':                       { equiv: 'month'            },
  'FAM_NOMBRE_MADRE':                    { clean: 'name'             },
  'FAM_APELLIDO_MADRE':                  { clean: 'name'             },
  'FAM_MES_MADRE':                       { equiv: 'month'            },

  // ── Trabajo ──
  'WET_PRESENT_CALLE':                   { clean: 'address'          },
  'WET_PRESENT_CIUDAD':                  { clean: 'name'             },
  'WET_PRESENT_ESTADO':                  { clean: 'name'             },
  'WET_PRESENT_TEL':                     { clean: 'phone'            },
  'WET_PRESENT_INGRESO_MES':             { equiv: 'month'            },
  'WET_PRESENT_NOBRE_LUGAR':             { clean: 'name'             },

};

function processField(pdfKey, value) {
  if (!value || value.trim() === '') return value;

  const rule = FIELD_RULES[pdfKey];
  if (!rule) return value;

  if (rule.clean) return CLEAN[rule.clean](value);

  if (rule.equiv) {
    const map = EQUIV[rule.equiv];
    const normalized = value
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const result = map[value.trim()] || map[normalized];
    if (!result) console.warn(`[VP] Sin equivalencia en "${rule.equiv}" para: "${value}"`);
    return result || value;
  }

  return value;
}
