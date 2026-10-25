import Peer from '../../vendor/peerjs/peerjs.min.js';

// The canonical source is owned beside the extension build and is projected
// onto the buildless remote site. It is an MIT-derived PeerJS 1.5.5 data-only
// fork: the PeerJS signaling/WebRTC ABI stays opaque while MediaConnection,
// binary/raw codecs, and global exports are absent.
export default Peer;
