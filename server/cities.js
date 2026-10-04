/** Destination + home cities for NexoraGo job & visa agency */

const PASSPORT_COUNTRIES = [
  { code: 'IN', name: 'India', flag: '🇮🇳', idTypes: ['aadhaar', 'passport', 'national_id'] },
  { code: 'PK', name: 'Pakistan', flag: '🇵🇰', idTypes: ['cnic', 'passport', 'national_id'] },
  { code: 'NP', name: 'Nepal', flag: '🇳🇵', idTypes: ['national_id', 'passport'] },
  { code: 'BD', name: 'Bangladesh', flag: '🇧🇩', idTypes: ['national_id', 'passport'] },
  { code: 'LK', name: 'Sri Lanka', flag: '🇱🇰', idTypes: ['national_id', 'passport'] },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', idTypes: ['national_id', 'passport'] },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', idTypes: ['national_id', 'passport'] },
  { code: 'QA', name: 'Qatar', flag: '🇶🇦', idTypes: ['national_id', 'passport'] },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭', idTypes: ['national_id', 'passport'] },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', idTypes: ['national_id', 'passport'] },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬', idTypes: ['national_id', 'passport'] },
  { code: 'OTHER', name: 'Other', flag: '🌍', idTypes: ['passport', 'national_id'] },
];

const HOME_CITIES_BY_COUNTRY = {
  IN: [
    'Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad',
    'Jaipur', 'Chandigarh', 'Kochi', 'Indore', 'Lucknow', 'Noida', 'Gurugram', 'Coimbatore', 'Other',
  ],
  PK: [
    'Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar',
    'Quetta', 'Sialkot', 'Gujranwala', 'Hyderabad', 'Other',
  ],
  NP: ['Kathmandu', 'Lalitpur', 'Pokhara', 'Biratnagar', 'Bharatpur', 'Other'],
  BD: ['Dhaka', 'Chittagong', 'Khulna', 'Rajshahi', 'Sylhet', 'Other'],
  LK: ['Colombo', 'Kandy', 'Galle', 'Jaffna', 'Other'],
  SA: ['Riyadh', 'Jeddah', 'Dammam', 'Khobar', 'Mecca', 'Medina', 'Other'],
  AE: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Other'],
  QA: ['Doha', 'Al Rayyan', 'Lusail', 'Other'],
  PH: ['Manila', 'Cebu', 'Davao', 'Quezon City', 'Other'],
  NG: ['Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Other'],
  EG: ['Cairo', 'Alexandria', 'Giza', 'Other'],
  OTHER: ['Other'],
};

const DESTINATION_CITIES = {
  CA: ['Toronto', 'Vancouver', 'Calgary', 'Montreal', 'Ottawa', 'Edmonton', 'Mississauga', 'Winnipeg'],
  DE: ['Berlin', 'Munich', 'Frankfurt', 'Hamburg', 'Cologne', 'Stuttgart', 'Düsseldorf', 'Leipzig'],
  GB: ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Leeds', 'Bristol', 'Glasgow', 'Cambridge'],
  NL: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven'],
  IE: ['Dublin', 'Cork', 'Galway', 'Limerick'],
  PT: ['Lisbon', 'Porto', 'Braga', 'Faro'],
  SE: ['Stockholm', 'Gothenburg', 'Malmö', 'Uppsala'],
  AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra'],
  US: ['New York', 'San Francisco', 'Seattle', 'Austin', 'Chicago', 'Boston', 'Dallas', 'Los Angeles'],
  AE: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'],
  NZ: ['Auckland', 'Wellington', 'Christchurch', 'Hamilton'],
  SG: ['Singapore'],
  JP: ['Tokyo', 'Osaka', 'Yokohama', 'Nagoya', 'Fukuoka'],
  FR: ['Paris', 'Lyon', 'Toulouse', 'Nantes', 'Nice'],
  PL: ['Warsaw', 'Kraków', 'Wrocław', 'Gdańsk'],
  MT: ['Valletta', 'Sliema', "St. Julian's"],
  SA: ['Riyadh', 'Jeddah', 'Dammam', 'Khobar'],
  QA: ['Doha', 'Al Rayyan', 'Lusail'],
  MY: ['Kuala Lumpur', 'Penang', 'Johor Bahru', 'Cyberjaya'],
  KR: ['Seoul', 'Busan', 'Incheon', 'Daegu'],
  CZ: ['Prague', 'Brno', 'Ostrava'],
  IT: ['Milan', 'Rome', 'Turin', 'Bologna'],
  ES: ['Madrid', 'Barcelona', 'Valencia', 'Málaga'],
  FI: ['Helsinki', 'Espoo', 'Tampere'],
  DK: ['Copenhagen', 'Aarhus', 'Odense'],
};

const HOME_CITIES = [
  ...new Set(Object.values(HOME_CITIES_BY_COUNTRY).flat()),
];

const JOB_TITLES = [
  'Software Engineer', 'Full Stack Developer', 'Data Engineer', 'DevOps Engineer',
  'Cloud Architect', 'QA Engineer', 'Product Manager', 'UI/UX Designer',
  'Business Analyst', 'Nurse / Healthcare', 'Civil Engineer', 'Mechanical Engineer',
  'Electrical Engineer', 'Accountant', 'Digital Marketing', 'Customer Support',
  'Warehouse / Logistics', 'Chef / Hospitality', 'Teacher / Trainer', 'Sales Executive',
  'Cook', 'Driver', 'Heavy Machinery Driver', 'Receptionist', 'General Labour',
  'Female Nurse', 'Female Child Care Taker',
];

module.exports = {
  DESTINATION_CITIES,
  HOME_CITIES,
  HOME_CITIES_BY_COUNTRY,
  PASSPORT_COUNTRIES,
  JOB_TITLES,
};
