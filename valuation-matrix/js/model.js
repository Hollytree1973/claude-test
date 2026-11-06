// State factories and shared constants. Part of the architecture contract.
export const CATEGORIES = [
  { key: 'condition', label: 'Condition', guidance: 'Good, average or poor relative to the subject' },
  { key: 'fittings', label: 'Fittings and specification', guidance: 'High, standard or basic fit out' },
  { key: 'kitchen', label: 'Kitchen', guidance: 'Bespoke, fitted or basic; age' },
  { key: 'gardens', label: 'Gardens', guidance: 'Size, aspect, quality; south facing premium' },
  { key: 'outbuildings', label: 'Outbuildings', guidance: 'Sheds, summer houses, workshops' },
  { key: 'glazing', label: 'Windows and glazing', guidance: 'UPVC, timber or aluminium; age and condition' },
  { key: 'aspect', label: 'Aspect and outlook', guidance: 'Views, green space, overlooked' },
  { key: 'location', label: 'Location and position', guidance: 'Road type, noise, proximity to amenities' },
  { key: 'layout', label: 'Layout and configuration', guidance: 'Open plan or cellular, flow, wasted space' },
  { key: 'epc', label: 'EPC and energy', guidance: 'Rating differential, heat pump, solar' },
  { key: 'parking', label: 'Parking', guidance: 'Use the parking reference by borough or area' },
  { key: 'garage', label: 'Garage', guidance: 'Integral, attached or detached; size' },
  { key: 'tenure', label: 'Tenure', guidance: 'Freehold or leasehold; lease length differential' },
  { key: 'extension', label: 'Extension potential', guidance: 'Permitted development or planning potential' },
  { key: 'age', label: 'Age', guidance: 'New build premium or period premium' },
  { key: 'type', label: 'Property type', guidance: 'Where type differs from the subject (limited use)' },
  { key: 'other', label: 'Other', guidance: 'Any other material factor; must be named in the note' },
];

export const PROPERTY_TYPES = ['detached', 'semi-detached', 'end-terrace', 'terraced', 'flat', 'maisonette', 'bungalow'];
export const CONDITIONS = ['good', 'average', 'below-average', 'poor'];
export const PARKING = ['garage', 'driveway', 'on-street', 'permit', 'none'];
export const SALE_KINDS = ['standard', 'auction', 'repossession', 'new-build'];
export const INSTRUCTION_TYPES = [
  ['mortgage', 'Mortgage'], ['purchase', 'Purchase or sale'], ['probate', 'Probate'], ['iht', 'Inheritance tax'],
  ['cgt', 'Capital gains tax'], ['matrimonial', 'Matrimonial'], ['help-to-buy', 'Help to Buy'],
  ['shared-ownership', 'Shared ownership'], ['btl', 'Buy to let'], ['rental', 'Rental assessment'], ['other', 'Other'],
];

let counter = 0;
export function newId() {
  counter += 1;
  return 'c' + Date.now().toString(36) + counter.toString(36);
}

export function todayIso() { return new Date().toISOString().slice(0, 10); }

export function createComparable(partial = {}) {
  return {
    id: newId(), address: '', postcode: '', propertyType: '', tenure: 'freehold', unexpiredTerm: null,
    bedrooms: null, floorAreaSqFt: null, floorAreaSqM: null, price: null, saleDate: '', distanceMiles: null,
    source: 'Rightmove SCT', saleKind: 'standard', hpiAtSale: null, quantumOverride: null,
    adjustments: {}, excluded: false, notes: '',
    ...partial,
  };
}

export function createState() {
  return {
    version: 1, caseRef: '', valuer: 'Andrew Gibson MRICS', valuationDate: todayIso(),
    instructionType: 'mortgage', matrixType: 'sales',
    subject: {
      address: '', postcode: '', propertyType: 'semi-detached', tenure: 'freehold', unexpiredTerm: null,
      groundRent: null, groundRentReview: '', bedrooms: null, floorAreaSqFt: null, floorAreaSqM: null,
      condition: 'average', parking: 'driveway', parkingArea: '', epc: '', garden: true, gardenNotes: '',
      features: '', defects: '',
    },
    hpi: { regionSlug: '', regionLabel: '', series: [], valuationIndex: null, source: '' },
    sales: [], rentals: [],
  };
}
