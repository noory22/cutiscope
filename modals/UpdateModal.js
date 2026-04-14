import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Linking, ScrollView, Platform, Alert, ActivityIndicator, NativeModules } from 'react-native';
import RNFS from 'react-native-fs';

const UpdateModal = ({ isVisible, updateInfo, onClose }) => {
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);

    if (!updateInfo) return null;

    const { forceUpdate, versionName, releaseNotes, downloadUrl } = updateInfo;

    const handleUpdate = async () => {
        if (!downloadUrl) return;

        if (Platform.OS === 'android') {
            setIsDownloading(true);
            const fileName = `dermaScope_v${versionName}.apk`;
            const path = `${RNFS.CachesDirectoryPath}/${fileName}`;

            console.log("Starting download to:", path);

            // Ensure fresh download
            RNFS.unlink(path).catch(() => { }); // Ignore error if file doesn't exist

            const ret = RNFS.downloadFile({
                fromUrl: downloadUrl,
                toFile: path,
                progress: (res) => {
                    setDownloadProgress(res.bytesWritten / res.contentLength);
                },
                progressDivider: 5
            });

            ret.promise.then((res) => {
                if (res.statusCode === 200) {
                    setIsDownloading(false);
                    setDownloadProgress(1);
                    // Install securely
                    NativeModules.AppUpdateModule.installApk(path);
                } else {
                    throw new Error(`Status Code: ${res.statusCode}`);
                }
            }).catch((err) => {
                console.error("Download Error:", err);
                setIsDownloading(false);
                Alert.alert("Update failed", "We couldn't download the update. Please check your connection and try again.");
            });

        } else {
            // iOS or other: Just open the link
            Linking.openURL(downloadUrl).catch(err => console.error("Couldn't load page", err));
        }
    };

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

                    {isDownloading ? (
                        <View style={styles.progressContainer}>
                            <ActivityIndicator size="large" color="#007AFF" />
                            <Text style={styles.progressText}>Downloading... {Math.round(downloadProgress * 100)}%</Text>
                        </View>
                    ) : (
                        <TouchableOpacity style={styles.updateButton} onPress={handleUpdate}>
                            <Text style={styles.buttonText}>Update Now</Text>
                        </TouchableOpacity>
                    )}

                    {!forceUpdate && !isDownloading && (
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
        marginBottom: 5,
        color: '#007AFF',
        fontWeight: '600'
    },
    progressBarBackground: {
        width: '100%',
        height: 10,
        backgroundColor: '#E0E0E0',
        borderRadius: 5,
        overflow: 'hidden'
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#007AFF',
        borderRadius: 5
    }
});

export default UpdateModal;
