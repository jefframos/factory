import { LoaderConfig } from 'core/loader/LoaderConfig';

// The board's warm sand backdrop, a brown bar like the anthill.
const loaderConfig: LoaderConfig = {
    backgroundColor: 'radial-gradient(circle at 50% 40%, #f8dcc0 0%, #f2c9a3 55%, #e2ad82 100%)',
    accentColor: '#ffffff',
    accentShadow: '0 3px 0 rgba(120, 70, 30, 0.35)',
    bar: {
        width: '300px',
        height: '24px',
        fillColor: 'linear-gradient(180deg, #b0784a 0%, #8a5530 100%)',
        fillRadius: '999px',
        backgroundColor: 'rgba(120, 70, 30, 0.25)',
        borderColor: '#ffffff',
        borderWidth: '3px',
        borderRadius: '999px',
    },
    fadeDuration: 300,
};

export default loaderConfig;
