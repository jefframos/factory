import { LoaderConfig } from 'core/loader/LoaderConfig';

// A warm kitchen backdrop, a tomato-red bar.
const loaderConfig: LoaderConfig = {
    backgroundColor: 'radial-gradient(circle at 50% 40%, #fbe3c4 0%, #f3d2a8 55%, #e6b583 100%)',
    accentColor: '#ffffff',
    accentShadow: '0 3px 0 rgba(120, 60, 30, 0.35)',
    bar: {
        width: '300px',
        height: '24px',
        fillColor: 'linear-gradient(180deg, #f2674e 0%, #c9412e 100%)',
        fillRadius: '999px',
        backgroundColor: 'rgba(120, 60, 30, 0.25)',
        borderColor: '#ffffff',
        borderWidth: '3px',
        borderRadius: '999px',
    },
    fadeDuration: 300,
};

export default loaderConfig;
