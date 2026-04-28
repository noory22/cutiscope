import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, Alert, ActivityIndicator, NativeModules } from 'react-native';


const UpdateModal = ({ isVisible, updateInfo, onClose }) => {
    const [isDownloading, setIsDownloading] = useState(false);

    if (!updateInfo) return null;

    const { forceUpdate, versionName, releaseNotes, downloadUrl, downloadComplete } = updateInfo;

    const handleUpdate = async () => {
        if (Platform.OS === 'android') {
            if (!downloadUrl) {
                Alert.alert("Update Error", "No download URL available. Please try again later.");
                return;
            }
            setIsDownloading(true);
            try {
                await NativeModules.AppUpdateModule.downloadUpdate(downloadUrl);
                // Download has been enqueued — the native BroadcastReceiver
                // will emit "onUpdateDownloaded" when it finishes,
                // which App.js handles by setting downloadComplete = true.
            } catch (err) {
                console.error("Download Error:", err);
                setIsDownloading(false);
                Alert.alert("Update failed", "We couldn't start the download. Please check your connection and try again.");
            }
        }
    };

    const handleInstall = async () => {
        try {
            await NativeModules.AppUpdateModule.installUpdate();
        } catch (err) {
            console.error("Install Error:", err);
            Alert.alert("Install failed", "Couldn't open the installer. Please check your Downloads folder for the update file.");
        }
    };

    // Determine current state
    const isDownloaded = downloadComplete === true;

    return (
        <Modal
            visible={isVisible}
            transparent={true}
            animationType="slide"
            onRequestClose={() => {
                if (!forceUpdate && onClose && !isDownloading) onClose();
            }}
        >
            <View style={styles.centeredView}>
                <View style={styles.modalView}>
                    <Text style={styles.title}>New Update Available!</Text>
                    <Text style={styles.version}>Version {versionName}</Text>

                    <Text style={styles.sectionTitle}>What's New:</Text>
                    <ScrollView style={styles.notesContainer}>
                        <Text style={styles.notes}>{releaseNotes || "Performance improvements and bug fixes."}</Text>
                    </ScrollView>

                    {isDownloaded ? (
                        /* ── State 3: Download complete ── */
                        <View style={styles.downloadedContainer}>
                            <Text style={styles.downloadedText}>✅ Update downloaded!</Text>
                            <TouchableOpacity style={styles.installButton} onPress={handleInstall}>
                                <Text style={styles.buttonText}>Install & Restart</Text>
                            </TouchableOpacity>
                        </View>
                    ) : isDownloading ? (
                        /* ── State 2: Downloading ── */
                        <View style={styles.progressContainer}>
                            <ActivityIndicator size="large" color="#007AFF" />
                            <Text style={styles.progressText}>Downloading update...</Text>
                        </View>
                    ) : (
                        /* ── State 1: Ready to update ── */
                        <TouchableOpacity style={styles.updateButton} onPress={handleUpdate}>
                            <Text style={styles.buttonText}>Update Now</Text>
                        </TouchableOpacity>
                    )}

                    {!forceUpdate && !isDownloading && !isDownloaded && (
                        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                            <Text style={styles.closeText}>Later</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </Modal >
    );
};

const styles = StyleSheet.create({
    centeredView: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: 'rgba(0,0,0,0.6)'
    },
    modalView: {
        width: '85%',
        maxHeight: '80%',
        backgroundColor: "white",
        borderRadius: 20,
        padding: 25,
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5
    },
    title: {
        fontSize: 22,
        fontWeight: "bold",
        marginBottom: 5,
        color: '#41403D'
    },
    version: {
        fontSize: 16,
        color: '#666',
        marginBottom: 20
    },
    sectionTitle: {
        alignSelf: 'flex-start',
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 8,
        color: '#333'
    },
    notesContainer: {
        width: '100%',
        maxHeight: 200,
        marginBottom: 25,
    },
    notes: {
        fontSize: 14,
        color: '#555',
        lineHeight: 22
    },
    updateButton: {
        backgroundColor: "#007AFF",
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 20,
        elevation: 2,
        width: '100%',
        alignItems: 'center'
    },
    buttonText: {
        color: "white",
        fontWeight: "bold",
        fontSize: 16
    },
    closeButton: {
        marginTop: 15,
        padding: 10
    },
    closeText: {
        color: "#999",
        fontSize: 16,
        fontWeight: '500'
    },
    progressContainer: {
        width: '100%',
        alignItems: 'center',
        marginVertical: 10
    },
    progressText: {
        marginTop: 10,
        color: '#007AFF',
        fontWeight: '600'
    },
    downloadedContainer: {
        width: '100%',
        alignItems: 'center',
    },
    downloadedText: {
        fontSize: 16,
        color: '#4CAF50',
        fontWeight: '600',
        marginBottom: 15,
    },
    installButton: {
        backgroundColor: "#4CAF50",
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 20,
        elevation: 2,
        width: '100%',
        alignItems: 'center'
    },
});

export default UpdateModal;
