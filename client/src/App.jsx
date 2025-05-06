// src/App.jsx - Fixed WebRTC implementation
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Video, Mic, MicOff, Monitor, VideoOff, X } from 'lucide-react';
import './App.css';
import 'webrtc-adapter';

const App = () => {
  const [socketId, setSocketId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isInRoom, setIsInRoom] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [usersInRoom, setUsersInRoom] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [remoteStreams, setRemoteStreams] = useState({});
  
  const socketRef = useRef();
  const userVideoRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const streamRef = useRef();
  const screenStreamRef = useRef();

  // STUN servers for ICE candidates
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: 'turn:your-turn-server.com:3478',
        username: 'your-username',
        credential: 'your-credential'
      }
    ]
  };

  useEffect(() => {
    // Connect to the signaling server with reconnection options
    socketRef.current = io.connect('http://localhost:8000', {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });
    
    // Get your socket ID
    socketRef.current.on('me', (id) => {
      setSocketId(id);
      console.log("Connected with socket ID:", id);
    });

    // Handle room full error
    socketRef.current.on('room_full', () => {
      setErrorMessage('Room is full. Maximum 3 users allowed.');
      setRoomInput('');
    });

    // Handle user list updates
    socketRef.current.on('users_in_room', (users) => {
      setUsersInRoom(users);
    });

    // Handle offer request
    socketRef.current.on('offer_request', async ({ from }) => {
      try {
        await createOffer(from);
      } catch (err) {
        console.error("Error creating offer:", err);
      }
    });

    // Handle offer
    socketRef.current.on('offer', async ({ from, offer }) => {
      try {
        await handleOffer(from, offer);
      } catch (err) {
        console.error("Error handling offer:", err);
      }
    });

    // Handle answer
    socketRef.current.on('answer', ({ from, answer }) => {
      try {
        const peerConnection = peerConnectionsRef.current[from];
        if (peerConnection) {
          peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      } catch (err) {
        console.error("Error handling answer:", err);
      }
    });

    // Handle ICE candidate
    socketRef.current.on('ice_candidate', ({ from, candidate }) => {
      try {
        const peerConnection = peerConnectionsRef.current[from];
        if (peerConnection) {
          peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error("Error adding ICE candidate:", err);
      }
    });

    // Handle user left
    socketRef.current.on('user_left', (id) => {
      try {
        if (peerConnectionsRef.current[id]) {
          peerConnectionsRef.current[id].close();
          delete peerConnectionsRef.current[id];
        }
        
        setRemoteStreams(prev => {
          const newStreams = { ...prev };
          delete newStreams[id];
          return newStreams;
        });
      } catch (err) {
        console.error("Error handling user disconnect:", err);
      }
    });

    return () => {
      // Clean up socket connection
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      
      // Stop all media tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          track.stop();
        });
      }
      
      // Clean up screen sharing
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => {
          track.stop();
        });
      }

      // Close all peer connections
      Object.values(peerConnectionsRef.current).forEach(connection => {
        if (connection) {
          connection.close();
        }
      });
    };
  }, []);

  const createPeerConnection = (userId) => {
    try {
      // Create new RTCPeerConnection
      const peerConnection = new RTCPeerConnection(iceServers);
      
      // Add local tracks to peer connection
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          peerConnection.addTrack(track, streamRef.current);
        });
      }
      
      // Handle ICE candidate events
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current.emit('ice_candidate', {
            to: userId,
            candidate: event.candidate
          });
        }
      };
      
      // Handle remote stream
      peerConnection.ontrack = (event) => {
        setRemoteStreams(prev => ({
          ...prev,
          [userId]: event.streams[0]
        }));
      };
      
      return peerConnection;
    } catch (err) {
      console.error("Error creating peer connection:", err);
      return null;
    }
  };

  const createOffer = async (userId) => {
    try {
      // Create peer connection if it doesn't exist
      if (!peerConnectionsRef.current[userId]) {
        const peerConnection = createPeerConnection(userId);
        peerConnectionsRef.current[userId] = peerConnection;
      }
      
      const peerConnection = peerConnectionsRef.current[userId];
      
      // Create offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      // Send offer to remote peer
      socketRef.current.emit('offer', {
        to: userId,
        offer: peerConnection.localDescription
      });
    } catch (err) {
      console.error("Error creating offer:", err);
    }
  };

  const handleOffer = async (userId, offer) => {
    try {
      // Create peer connection if it doesn't exist
      if (!peerConnectionsRef.current[userId]) {
        const peerConnection = createPeerConnection(userId);
        peerConnectionsRef.current[userId] = peerConnection;
      }
      
      const peerConnection = peerConnectionsRef.current[userId];
      
      // Set remote description (the offer)
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      // Create answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      // Send answer to remote peer
      socketRef.current.emit('answer', {
        to: userId,
        answer: peerConnection.localDescription
      });
    } catch (err) {
      console.error("Error handling offer:", err);
    }
  };

  const joinRoom = async () => {
    try {
      // Clear previous error messages
      setErrorMessage('');
      
      // First get user media and set isInRoom to trigger video element rendering
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      
      // Set room information
      setRoomId(roomInput);
      setIsInRoom(true);
      
      // We'll set the video element srcObject after the component re-renders
      // and the video element is available
      setTimeout(() => {
        if (userVideoRef.current) {
          userVideoRef.current.srcObject = stream;
        } else {
          console.error("Video element still not found after timeout");
        }
      }, 100);
      
      // Join a room
      socketRef.current.emit('join_room', roomInput);
    } catch (err) {
      console.error("Error accessing media devices:", err);
      if (err.name === 'NotAllowedError') {
        setErrorMessage('Camera or microphone access denied. Please allow access in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        setErrorMessage('Camera or microphone not found. Please check your device connections.');
      } else {
        setErrorMessage(`Failed to access camera or microphone: ${err.message}`);
      }
    }
  };

  const leaveRoom = () => {
    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
      });
    }
    
    // Close all peer connections
    Object.values(peerConnectionsRef.current).forEach(connection => {
      if (connection) {
        connection.close();
      }
    });
    
    // Reset states
    peerConnectionsRef.current = {};
    setRemoteStreams({});
    setIsInRoom(false);
    setRoomId('');
    setIsAudioMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    
    // Leave room
    socketRef.current.emit('leave_room');
  };

  const toggleAudio = () => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].enabled = isAudioMuted;
        setIsAudioMuted(!isAudioMuted);
      }
    }
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      const videoTracks = streamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks[0].enabled = isVideoOff;
        setIsVideoOff(!isVideoOff);
      }
    }
  };

  const shareScreen = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { cursor: true },
          audio: false
        });
        
        screenStreamRef.current = screenStream;
        
        // Replace video track for all peer connections
        const videoTrack = screenStream.getVideoTracks()[0];
        
        Object.values(peerConnectionsRef.current).forEach((pc) => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });
        
        // Update local video
        if (userVideoRef.current) {
          userVideoRef.current.srcObject = screenStream;
        }
        
        // Listen for screen sharing end
        videoTrack.onended = () => {
          stopScreenSharing();
        };
        
        setIsScreenSharing(true);
      } catch (err) {
        console.error("Error sharing screen:", err);
        setErrorMessage(`Failed to share screen: ${err.message}`);
      }
    } else {
      stopScreenSharing();
    }
  };

  const stopScreenSharing = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      
      // Replace screen track with camera track for all peer connections
      if (streamRef.current) {
        const videoTracks = streamRef.current.getVideoTracks();
        if (videoTracks.length > 0) {
          const videoTrack = videoTracks[0];
          
          Object.values(peerConnectionsRef.current).forEach((pc) => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
              sender.replaceTrack(videoTrack);
            }
          });
          
          // Update local video
          if (userVideoRef.current) {
            userVideoRef.current.srcObject = streamRef.current;
          }
        }
      }
      
      setIsScreenSharing(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      {!isInRoom ? (
        <div className="flex flex-col items-center justify-center h-full">
          <h1 className="text-3xl font-bold mb-8">WebRTC Mesh Video Call</h1>
          <div className="flex flex-col space-y-4 w-80">
            <input
              type="text"
              placeholder="Enter room ID"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button 
              onClick={joinRoom}
              disabled={!roomInput}
              className={`px-4 py-2 rounded ${!roomInput ? 'bg-gray-300' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
            >
              Join Room
            </button>
            {errorMessage && (
              <div className="text-red-500 text-sm">{errorMessage}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col h-full">
          <div className="bg-gray-100 p-4 flex justify-between items-center">
            <h2 className="text-xl font-semibold">Room: {roomId}</h2>
            <div className="text-sm">Connected Users: {usersInRoom.length}/3</div>
            <button 
              onClick={leaveRoom}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded flex items-center"
            >
              <X size={16} className="mr-1" /> Leave Room
            </button>
          </div>
          
          <div className="flex-1 flex flex-wrap p-4 gap-4 overflow-auto">
            {/* Local Video */}
            <div className="relative bg-gray-200 rounded-lg overflow-hidden w-full md:w-80 h-60">
              <video 
                ref={userVideoRef} 
                autoPlay 
                muted 
                playsInline 
                className="w-full h-full object-cover" 
              />
              <div className="absolute bottom-2 left-2 bg-gray-800 bg-opacity-60 text-white text-sm px-2 py-1 rounded">
                You {isScreenSharing ? '(Screen)' : ''}
              </div>
            </div>
            
            {/* Remote Videos */}
            {Object.keys(remoteStreams).map(peerId => (
              <div key={peerId} className="relative bg-gray-200 rounded-lg overflow-hidden w-full md:w-80 h-60">
                <RemoteVideo stream={remoteStreams[peerId]} />
                <div className="absolute bottom-2 left-2 bg-gray-800 bg-opacity-60 text-white text-sm px-2 py-1 rounded">
                  User {peerId.substring(0, 5)}
                </div>
              </div>
            ))}
          </div>
          
          <div className="bg-gray-100 p-4 flex justify-center space-x-4">
            <button 
              onClick={toggleAudio}
              className={`p-3 rounded-full ${isAudioMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-200 hover:bg-gray-300'}`}
              title={isAudioMuted ? "Unmute microphone" : "Mute microphone"}
            >
              {isAudioMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <button 
              onClick={toggleVideo}
              className={`p-3 rounded-full ${isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-200 hover:bg-gray-300'}`}
              title={isVideoOff ? "Turn on camera" : "Turn off camera"}
            >
              {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
            </button>
            <button 
              onClick={shareScreen}
              className={`p-3 rounded-full ${isScreenSharing ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
              title={isScreenSharing ? "Stop screen sharing" : "Share screen"}
            >
              <Monitor size={24} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Component to display remote video
const RemoteVideo = ({ stream }) => {
  const ref = useRef(null);

  useEffect(() => {
    const setVideoStream = () => {
      if (stream && ref.current) {
        ref.current.srcObject = stream;
      }
    };
    
    setVideoStream();
    // Add a small delay to ensure the ref is connected
    const timeoutId = setTimeout(setVideoStream, 100);
    
    return () => {
      clearTimeout(timeoutId);
      if (ref.current) {
        ref.current.srcObject = null;
      }
    };
  }, [stream]);

  return <video ref={ref} autoPlay playsInline className="w-full h-full object-cover" />;
};

export default App;