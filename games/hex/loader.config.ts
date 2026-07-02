import { LoaderConfig } from '@core/loader/LoaderConfig';

const loaderConfig: LoaderConfig = {
    backgroundColor: '#26C6DA',
    pattern: {
        image: 'hex/images/non-preload/jiggy-pattern.webp',
        opacity: 0.2,
    },
    bar: {
        width: '300px',
        height: '40px',
        fillColor: '#ffffff',
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        borderColor: '#ffffff',
        borderWidth: '2px',
        borderRadius: '8px',
    },
    fadeDuration: 400,
};

export default loaderConfig;
