export const SOUND_CONFIG = {
    // Weapon Sounds
    'deagle': {
        'shot': { volume: 1, hearingRange: 85, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadStart': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadEnd': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'pull': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' }
    },
    'ak-47': {
        'shot': { volume: 1, hearingRange: 75, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadStart': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadEnd': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'pull': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' }
    },
    'viper': {
        'shot': { volume: 1, hearingRange: 75, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadStart': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadEnd': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'pull': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' }
    },
    'knife': {
        'shot': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'hit': { volume: 1, hearingRange: 100, rolloffFactor: 2, distanceModel: 'linear' }, // e.g., hitting another player or surface
        'pull': { volume: 0.15, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' }
    },
    'marshal': { // Assuming 'marshal' is a shotgun/rifle type
        'shot': { volume: 1, hearingRange: 100, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadStart': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadEnd': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'pull': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' }
    },
    'legion': { // Assuming 'marshal' is a shotgun/rifle type
        'shot': { volume: 1, hearingRange: 100, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadStart': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadEnd': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'pull': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' }
    },
    'm79': {
        'shot': { volume: 1, hearingRange: 55, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadStart': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'reloadEnd': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' },
        'pull': { volume: 0.5, hearingRange: 25, rolloffFactor: 2, distanceModel: 'linear' }
    },
    // Physics Sounds (example)
    'footstep': {
        'run': { volume: 0.5, hearingRange: 35, rolloffFactor: 1.5, distanceModel: 'linear' },
        'walk': { volume: 0.5, hearingRange: 35, rolloffFactor: 1.5, distanceModel: 'linear' }
    },
    'landingThud': {
        'land': { volume: 0.5, hearingRange: 35, rolloffFactor: 1.5, distanceModel: 'linear' }
    },
    // Add more general physics sounds as needed, e.g., 'objectImpact', 'glassBreak'
    'objectImpact': {
        'light': { volume: 1, hearingRange: 20, rolloffFactor: 0.4, distanceModel: 'linear' },
        'medium': { volume: 1, hearingRange: 60, rolloffFactor: 0.4, distanceModel: 'linear' },
        'heavy': { volume: 1, hearingRange: 100, rolloffFactor: 0.4, distanceModel: 'linear' }
    },
    'glassBreak': {
        'small': { volume: 1, hearingRange: 80, rolloffFactor: 0.4, distanceModel: 'linear' },
        'large': { volume: 1.0, hearingRange: 150, rolloffFactor: 0.4, distanceModel: 'linear' }
    },

    // Environmental Sounds (example - these might be non-spatial or very far range spatial)
    'wind': {
        'ambient': { volume: 0.3, hearingRange: 500, rolloffFactor: 0.1, distanceModel: 'linear', loop: true }
    },
    'explosion': {
        'default': { volume: 1.0, hearingRange: 500, rolloffFactor: 0.8, distanceModel: 'linear' }
    }
};
