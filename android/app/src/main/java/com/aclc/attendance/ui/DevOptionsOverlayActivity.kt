package com.aclc.attendance.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import com.aclc.attendance.databinding.ActivityDevOptionsOverlayBinding
import com.aclc.attendance.util.DeveloperOptionsChecker

class DevOptionsOverlayActivity : AppCompatActivity() {
    private lateinit var binding: ActivityDevOptionsOverlayBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityDevOptionsOverlayBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnGoToSettings.setOnClickListener {
            startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))
        }

        binding.btnCheckAgain.setOnClickListener {
            if (DeveloperOptionsChecker.isThreatDetected(this)) {
                binding.btnCheckAgain.text = "Still enabled \u2013 disable developer options"
            } else {
                finish()
            }
        }
    }
}
