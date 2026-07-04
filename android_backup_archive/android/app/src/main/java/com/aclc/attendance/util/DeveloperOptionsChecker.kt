package com.aclc.attendance.util

import android.content.Context
import android.provider.Settings

object DeveloperOptionsChecker {
    fun isThreatDetected(context: Context): Boolean {
        val cr = context.contentResolver
        val devEnabled = Settings.Global.getInt(cr, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0)
        val adbEnabled = Settings.Global.getInt(cr, Settings.Global.ADB_ENABLED, 0)
        return devEnabled == 1 || adbEnabled == 1
    }
}
