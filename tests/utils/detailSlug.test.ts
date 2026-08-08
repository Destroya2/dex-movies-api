import { slugDepuisUrl, slugDeSujet } from '../../src/utils/detailSlug';

describe('slugDepuisUrl', () => {
  it('extrait le dernier segment d\'une URL de fiche', () => {
    expect(slugDepuisUrl('https://moviebox.ph/fr/detail/our-sticky-love-version-francaise-6pTvaiKKZe8'))
      .toBe('our-sticky-love-version-francaise-6pTvaiKKZe8');
  });

  it('ignore la query string et le slash final', () => {
    expect(slugDepuisUrl('https://moviebox.ph/fr/detail/naruto-vf-XYZ/?utm=1')).toBe('naruto-vf-XYZ');
  });

  it('rend undefined sur une URL absente', () => {
    expect(slugDepuisUrl(undefined)).toBeUndefined();
    expect(slugDepuisUrl('')).toBeUndefined();
  });
});

describe('slugDeSujet', () => {
  it('lit detailUrl — le seul champ que l\'API mobile remplit', () => {
    expect(slugDeSujet({ detailUrl: 'https://moviebox.ph/fr/detail/spider-noir-abc' })).toBe('spider-noir-abc');
  });

  it('accepte un detailPath déjà fourni (réponses h5)', () => {
    expect(slugDeSujet({ detailPath: 'deja-un-slug' })).toBe('deja-un-slug');
  });

  it('essaie les sources dans l\'ordre et ignore les vides', () => {
    expect(slugDeSujet({ detailPath: '  ' }, null, { detailUrl: 'https://x/y/le-bon-slug' }))
      .toBe('le-bon-slug');
    expect(slugDeSujet({}, undefined)).toBeUndefined();
  });
});
