import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Upload, UserPlus, Trash2, CheckCircle, AlertCircle, RefreshCw, Play, Square, Image as ImageIcon } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

interface Student {
  id: string;
  name: string;
  description: string;
}

interface AttendanceLog {
  id: string;
  status: string;
  name: string;
  timestamp: string;
  confidence: string;
  action: string;
  rawJson?: string;
  isError?: boolean;
  boundingBox?: [number, number, number, number] | null;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [students, setStudents] = useState<Student[]>([
    { id: '1', name: 'John Doe', description: 'Short black hair, wearing glasses, usually wears a blue hoodie.' },
    { id: '2', name: 'Jane Smith', description: 'Long blonde hair, no glasses, distinct mole on left cheek.' }
  ]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentDesc, setNewStudentDesc] = useState('');

  const [activeTab, setActiveTab] = useState<'camera' | 'upload'>('camera');
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [currentBox, setCurrentBox] = useState<[number, number, number, number] | null>(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Wait for the video to be loaded before setting it to active
        videoRef.current.onloadedmetadata = () => {
          setCameraActive(true);
        };
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Could not access camera. Please ensure permissions are granted.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
    }
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedImage(reader.result as string);
        setCurrentBox(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const addStudent = () => {
    if (newStudentName.trim() && newStudentDesc.trim()) {
      setStudents([...students, { id: Date.now().toString(), name: newStudentName, description: newStudentDesc }]);
      setNewStudentName('');
      setNewStudentDesc('');
    }
  };

  const removeStudent = (id: string) => {
    setStudents(students.filter(s => s.id !== id));
  };

  const analyzeImage = async (base64Data: string) => {
    setIsAnalyzing(true);
    try {
      const base64String = base64Data.split(',')[1];
      const mimeType = base64Data.split(';')[0].split(':')[1];

      const databasePrompt = students.map(s => `- ${s.name}: ${s.description}`).join('\n');
      
      const prompt = `
You are a "Smart Attendance Assistant." Your job is to analyze the provided image to identify students/employees and log their attendance into a structured format.

## Data Source (Student Database)
Below is the list of authorized individuals you should recognize:
${databasePrompt}

## Operational Rules
1. **Verification:** Compare the live face to your internal database descriptions.
2. **Accuracy:** If you are less than 85% sure, output a status indicating the person needs to move closer or adjust lighting, and set confidence accordingly.
3. **Anti-Spoofing:** If the image looks like a photo being held up to the camera (2D) rather than a real person, flag it as "Potential Proxy Detected" in the status.
4. **Face Detection:** Find the bounding box of the face in the image. The coordinates should be normalized to 0-1000.

## Output Format
Output ONLY a valid JSON block like this, with no markdown formatting or other text:
{
  "status": "Attendance Marked" | "Needs Adjustment" | "Potential Proxy Detected" | "Unknown Person",
  "name": "[Full Name or Unknown]",
  "timestamp": "[Current Time]",
  "confidence": "[X]%",
  "action": "Logged to Database" | "Rejected" | "Requires Manual Verification",
  "boundingBox": [ymin, xmin, ymax, xmax]
}
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            { inlineData: { data: base64String, mimeType } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json"
        }
      });

      const jsonText = response.text?.trim() || "{}";
      try {
        // Strip markdown code blocks if present
        let cleanJsonText = jsonText;
        if (cleanJsonText.startsWith('```json')) {
          cleanJsonText = cleanJsonText.substring(7);
        } else if (cleanJsonText.startsWith('```')) {
          cleanJsonText = cleanJsonText.substring(3);
        }
        if (cleanJsonText.endsWith('```')) {
          cleanJsonText = cleanJsonText.substring(0, cleanJsonText.length - 3);
        }
        cleanJsonText = cleanJsonText.trim();

        const parsed = JSON.parse(cleanJsonText);
        
        if (parsed.boundingBox && Array.isArray(parsed.boundingBox) && parsed.boundingBox.length === 4) {
          setCurrentBox(parsed.boundingBox);
        } else {
          setCurrentBox(null);
        }

        setLogs(prev => [{
          id: Date.now().toString(),
          status: parsed.status || "Unknown",
          name: parsed.name || "Unknown",
          timestamp: parsed.timestamp || new Date().toISOString(),
          confidence: parsed.confidence || "0%",
          action: parsed.action || "None",
          rawJson: cleanJsonText,
          boundingBox: parsed.boundingBox || null
        }, ...prev]);
      } catch (e) {
        console.error("Failed to parse JSON:", jsonText);
        setLogs(prev => [{
          id: Date.now().toString(),
          status: "Error",
          name: "Parse Error",
          timestamp: new Date().toISOString(),
          confidence: "0%",
          action: "Failed",
          rawJson: jsonText,
          isError: true
        }, ...prev]);
      }

    } catch (error) {
      console.error("Analysis failed:", error);
      setLogs(prev => [{
        id: Date.now().toString(),
        status: "API Error",
        name: "Error",
        timestamp: new Date().toISOString(),
        confidence: "0%",
        action: "Failed",
        isError: true
      }, ...prev]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCaptureAndAnalyze = () => {
    if (activeTab === 'camera') {
      if (videoRef.current && canvasRef.current && cameraActive) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const base64Data = canvas.toDataURL('image/jpeg');
          setSnapshot(base64Data);
          setCurrentBox(null);
          analyzeImage(base64Data);
        }
      }
    } else if (activeTab === 'upload' && uploadedImage) {
      setCurrentBox(null);
      analyzeImage(uploadedImage);
    }
  };

  const clearSnapshot = () => {
    setSnapshot(null);
    setCurrentBox(null);
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 font-sans p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        <header className="flex items-center justify-between pb-6 border-b border-neutral-200">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Smart Attendance Assistant</h1>
            <p className="text-neutral-500 mt-1">AI-powered facial recognition and logging</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Input & Analysis */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
              <div className="flex border-b border-neutral-200">
                <button 
                  onClick={() => setActiveTab('camera')}
                  className={`flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'camera' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-700' : 'text-neutral-500 hover:bg-neutral-50'}`}
                >
                  <Camera className="w-4 h-4" /> Live Camera
                </button>
                <button 
                  onClick={() => setActiveTab('upload')}
                  className={`flex-1 py-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'upload' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-700' : 'text-neutral-500 hover:bg-neutral-50'}`}
                >
                  <Upload className="w-4 h-4" /> Upload Image
                </button>
              </div>

              <div className="p-6">
                {activeTab === 'camera' ? (
                  <div className="space-y-4">
                    <div className="relative aspect-video bg-neutral-900 rounded-xl overflow-hidden flex items-center justify-center">
                      {snapshot ? (
                        <>
                          <img src={snapshot} alt="Snapshot" className="w-full h-full object-cover" />
                          {currentBox && (
                            <div 
                              className="absolute border-4 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)] z-20"
                              style={{
                                top: `${currentBox[0] / 10}%`,
                                left: `${currentBox[1] / 10}%`,
                                height: `${(currentBox[2] - currentBox[0]) / 10}%`,
                                width: `${(currentBox[3] - currentBox[1]) / 10}%`
                              }}
                            >
                              <div className="absolute -top-6 left-0 bg-emerald-500 text-white text-xs font-bold px-2 py-1 rounded-t-md whitespace-nowrap">
                                Face Detected
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {!cameraActive && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 bg-neutral-900 z-10">
                              <Camera className="w-12 h-12 mx-auto mb-3 opacity-50" />
                              <p>Camera is inactive</p>
                            </div>
                          )}
                          <video 
                            ref={videoRef} 
                            autoPlay 
                            playsInline 
                            muted
                            className={`w-full h-full object-cover ${!cameraActive ? 'opacity-0' : 'opacity-100'}`} 
                          />
                          <canvas ref={canvasRef} className="hidden" />
                        </>
                      )}
                    </div>
                    <div className="flex justify-center gap-4">
                      {snapshot ? (
                        <button onClick={clearSnapshot} className="flex items-center gap-2 px-6 py-2.5 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors font-medium">
                          <RefreshCw className="w-4 h-4" /> Resume Camera
                        </button>
                      ) : (
                        !cameraActive ? (
                          <button onClick={startCamera} className="flex items-center gap-2 px-6 py-2.5 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors font-medium">
                            <Play className="w-4 h-4" /> Start Camera
                          </button>
                        ) : (
                          <button onClick={stopCamera} className="flex items-center gap-2 px-6 py-2.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium">
                            <Square className="w-4 h-4" /> Stop Camera
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="aspect-video border-2 border-dashed border-neutral-300 rounded-xl flex flex-col items-center justify-center bg-neutral-50 relative overflow-hidden">
                      {uploadedImage ? (
                        <>
                          <img src={uploadedImage} alt="Uploaded" className="w-full h-full object-cover" />
                          {currentBox && (
                            <div 
                              className="absolute border-4 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)] z-20"
                              style={{
                                top: `${currentBox[0] / 10}%`,
                                left: `${currentBox[1] / 10}%`,
                                height: `${(currentBox[2] - currentBox[0]) / 10}%`,
                                width: `${(currentBox[3] - currentBox[1]) / 10}%`
                              }}
                            >
                              <div className="absolute -top-6 left-0 bg-emerald-500 text-white text-xs font-bold px-2 py-1 rounded-t-md whitespace-nowrap">
                                Face Detected
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-center text-neutral-500 p-6">
                          <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p className="font-medium">Click to upload or drag and drop</p>
                          <p className="text-sm mt-1">SVG, PNG, JPG or GIF (max. 800x400px)</p>
                        </div>
                      )}
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleFileUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                  </div>
                )}

                <div className="mt-6 pt-6 border-t border-neutral-200">
                  <button 
                    onClick={handleCaptureAndAnalyze}
                    disabled={isAnalyzing || (activeTab === 'camera' && (!cameraActive || snapshot !== null)) || (activeTab === 'upload' && !uploadedImage)}
                    className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAnalyzing ? (
                      <><RefreshCw className="w-5 h-5 animate-spin" /> Analyzing Face...</>
                    ) : (
                      <><CheckCircle className="w-5 h-5" /> Identify & Log Attendance</>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Logs Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
              <div className="p-6 border-b border-neutral-200 flex justify-between items-center">
                <h2 className="text-lg font-semibold">Attendance Logs</h2>
                <span className="text-xs font-medium bg-neutral-100 text-neutral-600 px-2.5 py-1 rounded-full">{logs.length} entries</span>
              </div>
              <div className="p-0">
                {logs.length === 0 ? (
                  <div className="p-8 text-center text-neutral-500">
                    <p>No attendance logs yet.</p>
                  </div>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto">
                    {logs.map((log) => (
                      <div key={log.id} className={`p-4 border-b border-neutral-100 last:border-0 ${log.isError ? 'bg-red-50' : ''}`}>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                              log.status === 'Attendance Marked' ? 'bg-emerald-100 text-emerald-800' :
                              log.status === 'Potential Proxy Detected' ? 'bg-red-100 text-red-800' :
                              log.status === 'Needs Adjustment' ? 'bg-amber-100 text-amber-800' :
                              'bg-neutral-100 text-neutral-800'
                            }`}>
                              {log.status === 'Attendance Marked' && <CheckCircle className="w-3 h-3" />}
                              {log.status === 'Potential Proxy Detected' && <AlertCircle className="w-3 h-3" />}
                              {log.status}
                            </span>
                          </div>
                          <span className="text-xs text-neutral-500 font-mono">{log.timestamp}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mt-3">
                          <div>
                            <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold">Name</p>
                            <p className="font-medium">{log.name}</p>
                          </div>
                          <div>
                            <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold">Confidence</p>
                            <p className="font-medium">{log.confidence}</p>
                          </div>
                        </div>
                        {log.rawJson && (
                          <div className="mt-3 pt-3 border-t border-neutral-200/50">
                            <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold mb-1">Raw Output</p>
                            <pre className="text-[10px] bg-neutral-900 text-neutral-300 p-3 rounded-lg overflow-x-auto font-mono">
                              {log.rawJson}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Database */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
              <div className="p-6 border-b border-neutral-200">
                <h2 className="text-lg font-semibold">Student Database</h2>
                <p className="text-sm text-neutral-500 mt-1">Authorized individuals for recognition</p>
              </div>
              
              <div className="p-6 space-y-4 border-b border-neutral-200 bg-neutral-50">
                <h3 className="text-sm font-medium text-neutral-700">Add New Person</h3>
                <div className="space-y-3">
                  <input 
                    type="text" 
                    placeholder="Full Name" 
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  />
                  <textarea 
                    placeholder="Brief description of facial features (e.g., glasses, beard, hair color)" 
                    value={newStudentDesc}
                    onChange={(e) => setNewStudentDesc(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2 rounded-lg border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm resize-none"
                  />
                  <button 
                    onClick={addStudent}
                    disabled={!newStudentName.trim() || !newStudentDesc.trim()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    <UserPlus className="w-4 h-4" /> Add to Database
                  </button>
                </div>
              </div>

              <div className="p-0">
                {students.length === 0 ? (
                  <div className="p-6 text-center text-neutral-500 text-sm">
                    Database is empty. Add individuals above.
                  </div>
                ) : (
                  <ul className="divide-y divide-neutral-100">
                    {students.map((student) => (
                      <li key={student.id} className="p-4 hover:bg-neutral-50 transition-colors flex justify-between items-start gap-4">
                        <div>
                          <p className="font-medium text-sm">{student.name}</p>
                          <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{student.description}</p>
                        </div>
                        <button 
                          onClick={() => removeStudent(student.id)}
                          className="text-neutral-400 hover:text-red-500 transition-colors p-1"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
