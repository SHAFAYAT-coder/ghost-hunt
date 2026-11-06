// Evidence, ghosts, equipment and maps

export const EVIDENCE = {
  emf: 'EMF Level 5',
  freezing: 'Freezing Temperatures',
  spirit: 'Spirit Box',
  writing: 'Ghost Writing',
  fingers: 'Fingerprints'
};

export const GHOSTS = [
  { id: 'spirit',  name: 'Spirit',  evidence: ['spirit', 'writing', 'emf'] },
  { id: 'wraith',  name: 'Wraith',  evidence: ['spirit', 'fingers', 'freezing'] },
  { id: 'phantom', name: 'Phantom', evidence: ['fingers', 'emf', 'freezing'] },
  { id: 'demon',   name: 'Demon',   evidence: ['writing', 'fingers', 'freezing'] }
];

export const EQUIPMENT = {
  emf:      { name: 'EMF Reader',         price: 50, icon: '📟', desc: 'Shows the EMF level near the ghost. Level 5 = EMF evidence.' },
  thermo:   { name: 'Thermometer',        price: 50, icon: '🌡️', desc: 'Freezing temperatures near the ghost = evidence.' },
  spirit:   { name: 'Spirit Box',         price: 70, icon: '📻', desc: 'Hold R near the ghost for 2 seconds to talk to it.' },
  writing:  { name: 'Ghost Writing Book', price: 40, icon: '📖', desc: 'Stand within 3 units of the ghost and press Q.' },
  uv:       { name: 'UV Flashlight',      price: 60, icon: '🔦', desc: 'Select it and press F to show footprints.' },
  pills:    { name: 'Sanity Pills',       price: 30, icon: '💊', desc: 'Press X to restore 30 sanity (20 second cooldown).' },
  crucifix: { name: 'Crucifix',           price: 90, icon: '✝️', desc: 'Left click within 5 units of the ghost to push it back.' },
  camera:   { name: 'Photo Camera',       price: 80, icon: '📷', desc: 'Left click to take a photo. Photos anger the ghost.' }
};

export const MAPS = {
  school: { name: 'Abandoned School', desc: 'Dusty classrooms and long corridors.' },
  camp:   { name: 'Summer Camp',      desc: 'Old cabins under dark pine trees.' },
  hostel: { name: 'Old Hostel',       desc: 'Narrow corridors and empty bedrooms.' }
};

export const START_CASH = 300;
export const MAX_LOADOUT = 4;
