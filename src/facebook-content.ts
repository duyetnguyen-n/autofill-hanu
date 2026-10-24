import {startFacebookReader} from './facebook-reader';

startFacebookReader(document,message=>chrome.runtime.sendMessage(message));
